// ── Eusol Organics — Paystack POS Integration ──
frappe.provide("custom_erp_paystack");

(function() {
    var PAYSTACK_MODE = "paystack";
    var pollTimer = null;

    function is_paystack_selected() {
        var selected = document.querySelector('.mode-of-payment.border-primary[data-mode]');
        return selected && selected.getAttribute('data-mode').toLowerCase() === PAYSTACK_MODE;
    }

    function get_paystack_amount() {
        var amountEl = document.querySelector('[data-mode="paystack"] .pay-amount');
        if (!amountEl) return 0;
        var text = amountEl.textContent.replace(/[^0-9.]/g, '');
        return parseFloat(text) || 0;
    }

    function intercept_complete_order() {
        var btn = document.querySelector('.btn-complete-order, .complete-order-btn, button.btn-primary.complete-order');
        if (!btn || btn._paystack_hooked) return;

        btn._paystack_hooked = true;
        btn.addEventListener('click', function(e) {
            if (!is_paystack_selected()) return; // let normal flow handle it

            e.preventDefault();
            e.stopImmediatePropagation();

            var amount = get_paystack_amount();
            var invoice = cur_pos && cur_pos.frm && cur_pos.frm.doc && cur_pos.frm.doc.name;
            var customer = cur_pos && cur_pos.frm && cur_pos.frm.doc && cur_pos.frm.doc.customer;

            if (!amount || !invoice) {
                frappe.msgprint("Could not get invoice details. Please try again.");
                return;
            }

            get_customer_email(customer, function(email) {
                start_paystack_flow(amount, email, invoice);
            });
        }, true); // capture phase so we run before Vue
    }

    function get_customer_email(customer, callback) {
        if (!customer) return callback("guest@eusolgh.com");
        frappe.db.get_value("Customer", customer, "email_id", function(r) {
            callback((r && r.email_id) || "guest@eusolgh.com");
        });
    }

    function start_paystack_flow(amount, email, invoice_name) {
        var reference = "EO-" + invoice_name.replace(/[^a-zA-Z0-9]/g, '') + "-" + Date.now();

        frappe.call({
            method: "custom_erp_paystack.api.initialize_payment",
            args: {
                email: email,
                amount: amount,
                reference: reference,
                invoice_name: invoice_name
            },
            freeze: true,
            freeze_message: "Generating Paystack payment link...",
            callback: function(r) {
                if (r.message && r.message.authorization_url) {
                    show_payment_dialog(r.message.authorization_url, reference, invoice_name, amount);
                } else {
                    frappe.msgprint("Failed to generate Paystack payment link.");
                }
            }
        });
    }

    function show_payment_dialog(url, reference, invoice_name, amount) {
        var d = new frappe.ui.Dialog({
            title: "Pay with Paystack — ₵" + amount,
            fields: [
                {
                    fieldtype: "HTML",
                    fieldname: "pay_html",
                    options: `
                    <div style="text-align:center;padding:16px 8px;">
                        <p style="font-size:13px;color:#1b3a2d;margin-bottom:12px;font-weight:500;">
                            Ask the customer to scan the QR code or tap the link below to pay
                        </p>
                        <div id="ps-qr" style="margin:0 auto 16px;width:200px;height:200px;background:#f5f0e4;border-radius:8px;display:flex;align-items:center;justify-content:center;">
                            <span style="font-size:12px;color:#888;">Loading QR...</span>
                        </div>
                        <a href="${url}" target="_blank"
                           style="font-size:12px;color:#5a8a6a;word-break:break-all;display:block;margin-bottom:16px;">
                           ${url}
                        </a>
                        <div id="ps-status" style="padding:10px;border-radius:8px;background:#f5f0e4;font-size:13px;font-weight:500;color:#854f0b;">
                            ⏳ Waiting for payment...
                        </div>
                    </div>`
                }
            ],
            primary_action_label: "I've confirmed payment manually",
            primary_action: function() {
                clearInterval(pollTimer);
                d.hide();
                complete_pos_order();
            },
            secondary_action_label: "Cancel",
            secondary_action: function() {
                clearInterval(pollTimer);
                d.hide();
            }
        });
        d.show();

        // Render QR code
        setTimeout(function() {
            var qrEl = document.getElementById("ps-qr");
            if (qrEl) {
                qrEl.innerHTML = '<img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=' +
                    encodeURIComponent(url) + '" style="width:200px;height:200px;border-radius:6px;" />';
            }
        }, 200);

        // Poll every 5 seconds for payment confirmation
        pollTimer = setInterval(function() {
            frappe.call({
                method: "custom_erp_paystack.api.verify_payment",
                args: { reference: reference },
                callback: function(r) {
                    if (r.message && r.message.status === "success") {
                        clearInterval(pollTimer);
                        var statusEl = document.getElementById("ps-status");
                        if (statusEl) {
                            statusEl.textContent = "✅ Payment confirmed!";
                            statusEl.style.background = "#eaf3de";
                            statusEl.style.color = "#3b6d11";
                        }
                        setTimeout(function() {
                            d.hide();
                            complete_pos_order();
                        }, 1500);
                    }
                }
            });
        }, 5000);

        d.onhide = function() { clearInterval(pollTimer); };
    }

    function complete_pos_order() {
        // Programmatically click the complete order button without our intercept
        var btn = document.querySelector('.btn-complete-order, .complete-order-btn, button.btn-primary.complete-order');
        if (btn) {
            btn._paystack_hooked = false; // temporarily remove our hook
            btn.click();
            setTimeout(function() { btn._paystack_hooked = true; }, 1000);
        } else if (cur_pos && cur_pos.submit_invoice) {
            cur_pos.submit_invoice();
        }
    }

    // Watch for the Complete Order button to appear
    var observer = new MutationObserver(function() {
        intercept_complete_order();
    });

    frappe.ready(function() {
        observer.observe(document.body, { childList: true, subtree: true });
    });

})();
