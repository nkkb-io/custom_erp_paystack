// ── Eusol Organics — Paystack POS Integration ──
// Triggers Paystack for MoMo and Card payments, leaves Cash alone
frappe.provide("custom_erp_paystack");

(function() {
    var PAYSTACK_MODES = ["mobile money (momo)", "mobile money", "momo", "card", "bank transfer"];
    var pollTimer = null;
    var paystack_btn_added = false;

    function get_selected_mode() {
        var el = document.querySelector('.mode-of-payment.border-primary[data-mode]');
        return el ? el.getAttribute('data-mode').toLowerCase() : null;
    }

    function is_paystack_mode() {
        var mode = get_selected_mode();
        if (!mode) return false;
        return PAYSTACK_MODES.some(function(m) { return mode.indexOf(m) !== -1; });
    }

    function get_amount() {
        var el = document.querySelector('.mode-of-payment.border-primary .pay-amount');
        if (!el) {
            el = document.querySelector('.grand-total-value, .grand-total');
        }
        if (!el) return 0;
        return parseFloat(el.textContent.replace(/[^0-9.]/g, '')) || 0;
    }

    function get_confirm_btn() {
        return Array.from(document.querySelectorAll('button')).find(function(b) {
            return b.textContent.trim().toLowerCase() === 'confirm';
        });
    }

    function disable_confirm() {
        var btn = get_confirm_btn();
        if (btn) {
            btn.disabled = true;
            btn.style.opacity = '0.4';
            btn.style.cursor = 'not-allowed';
            btn.title = 'Complete Paystack payment first';
        }
    }

    function enable_confirm() {
        var btn = get_confirm_btn();
        if (btn) {
            btn.disabled = false;
            btn.style.opacity = '1';
            btn.style.cursor = 'pointer';
            btn.title = '';
        }
    }

    function add_paystack_btn() {
        if (document.getElementById('ps-pay-btn')) return;

        var confirm_btn = get_confirm_btn();
        if (!confirm_btn) return;

        var btn = document.createElement('button');
        btn.id = 'ps-pay-btn';
        btn.className = 'btn btn-sm btn-primary';
        btn.style.cssText = 'width:100%;margin-bottom:8px;background:#1b3a2d;border-color:#1b3a2d;font-family:DM Sans,sans-serif;';
        btn.textContent = 'Pay via Paystack';
        btn.onclick = function(e) {
            e.preventDefault();
            var doc = cur_pos && cur_pos.frm && cur_pos.frm.doc;
            var invoice_name = doc && doc.name;
            var customer = doc && doc.customer;
            var amount = get_amount();

            if (!amount || !invoice_name) {
                frappe.msgprint("Could not get invoice details.");
                return;
            }

            get_customer_email(customer, function(email) {
                launch_paystack(amount, email, invoice_name);
            });
        };

        confirm_btn.parentNode.insertBefore(btn, confirm_btn);
        disable_confirm();
    }

    function remove_paystack_btn() {
        var btn = document.getElementById('ps-pay-btn');
        if (btn) btn.remove();
        enable_confirm();
    }

    function get_customer_email(customer, callback) {
        if (!customer) return callback("guest@eusolgh.com");
        frappe.db.get_value("Customer", customer, "email_id", function(r) {
            callback((r && r.email_id) || "guest@eusolgh.com");
        });
    }

    function launch_paystack(amount, email, invoice_name) {
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
                    show_dialog(r.message.authorization_url, reference, amount);
                } else {
                    frappe.msgprint("Failed to generate Paystack link. Please try again.");
                }
            }
        });
    }

    function show_dialog(url, reference, amount) {
        var d = new frappe.ui.Dialog({
            title: "Pay via Paystack \u2014 \u20B5" + parseFloat(amount).toFixed(2),
            fields: [{
                fieldtype: "HTML",
                fieldname: "pay_html",
                options:
                    '<div style="text-align:center;padding:16px 8px;">' +
                    '<p style="font-size:13px;color:#1b3a2d;margin-bottom:12px;font-weight:500;">' +
                    'Ask the customer to scan the QR code or open the link to pay.' +
                    '</p>' +
                    '<div id="ps-qr" style="margin:0 auto 16px;width:200px;height:200px;' +
                    'background:#f5f0e4;border-radius:8px;display:flex;align-items:center;justify-content:center;">' +
                    '<span style="font-size:12px;color:#888;">Loading QR...</span>' +
                    '</div>' +
                    '<a href="' + url + '" target="_blank" ' +
                    'style="font-size:12px;color:#5a8a6a;word-break:break-all;display:block;margin-bottom:16px;">' +
                    url + '</a>' +
                    '<div id="ps-status" style="padding:10px;border-radius:8px;background:#f5f0e4;' +
                    'font-size:13px;font-weight:500;color:#854f0b;">' +
                    '\u23F3 Waiting for payment...</div>' +
                    '</div>'
            }],
            primary_action_label: "Confirm payment manually",
            primary_action: function() {
                clearInterval(pollTimer);
                d.hide();
                on_payment_confirmed();
            },
            secondary_action_label: "Cancel",
            secondary_action: function() {
                clearInterval(pollTimer);
                d.hide();
            }
        });

        d.show();

        setTimeout(function() {
            var qrEl = document.getElementById("ps-qr");
            if (qrEl) {
                qrEl.innerHTML =
                    '<img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=' +
                    encodeURIComponent(url) +
                    '" style="width:200px;height:200px;border-radius:6px;" />';
            }
        }, 300);

        pollTimer = setInterval(function() {
            frappe.call({
                method: "custom_erp_paystack.api.verify_payment",
                args: { reference: reference },
                callback: function(r) {
                    if (r.message && r.message.status === "success") {
                        clearInterval(pollTimer);
                        var el = document.getElementById("ps-status");
                        if (el) {
                            el.textContent = "\u2705 Payment confirmed!";
                            el.style.background = "#eaf3de";
                            el.style.color = "#3b6d11";
                        }
                        setTimeout(function() {
                            d.hide();
                            on_payment_confirmed();
                        }, 1500);
                    }
                }
            });
        }, 5000);

        d.onhide = function() { clearInterval(pollTimer); };
    }

    function on_payment_confirmed() {
        // Remove our button and enable + auto-click Confirm
        remove_paystack_btn();
        setTimeout(function() {
            var btn = get_confirm_btn();
            if (btn) btn.click();
        }, 300);
    }

    // Watch for payment mode changes and checkout screen
    var last_mode = null;
    var observer = new MutationObserver(function() {
        var mode = get_selected_mode();

        // Payment mode changed
        if (mode !== last_mode) {
            last_mode = mode;
            if (is_paystack_mode()) {
                add_paystack_btn();
            } else {
                remove_paystack_btn();
            }
        }

        // Also check if paystack button needs to be added/removed
        if (is_paystack_mode() && get_confirm_btn() && !document.getElementById('ps-pay-btn')) {
            add_paystack_btn();
        } else if (!is_paystack_mode() && document.getElementById('ps-pay-btn')) {
            remove_paystack_btn();
        }
    });

    frappe.ready(function() {
        observer.observe(document.body, { childList: true, subtree: true });
    });

})();