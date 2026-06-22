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
        var amountEl = document.querySelector('[data-mode="' + PAYSTACK_MODE + '"] .pay-amount');
        if (!amountEl) return 0;
        return parseFloat(amountEl.textContent.replace(/[^0-9.]/g, '')) || 0;
    }

    function get_customer_email(customer, callback) {
        if (!customer) return callback("guest@eusolgh.com");
        frappe.db.get_value("Customer", customer, "email_id", function(r) {
            callback((r && r.email_id) || "guest@eusolgh.com");
        });
    }

    function start_paystack_flow(amount, email, invoice_name, on_success) {
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
                    show_payment_dialog(r.message.authorization_url, reference, amount, on_success);
                } else {
                    frappe.msgprint("Failed to generate Paystack payment link. Please try again.");
                }
            }
        });
    }

    function show_payment_dialog(url, reference, amount, on_success) {
        var d = new frappe.ui.Dialog({
            title: "Pay with Paystack \u2014 \u20B5" + parseFloat(amount).toFixed(2),
            fields: [{
                fieldtype: "HTML",
                fieldname: "pay_html",
                options: '<div style="text-align:center;padding:16px 8px;">' +
                    '<p style="font-size:13px;color:#1b3a2d;margin-bottom:12px;font-weight:500;">Ask the customer to scan the QR code or open the link below to pay.</p>' +
                    '<div id="ps-qr" style="margin:0 auto 16px;width:200px;height:200px;background:#f5f0e4;border-radius:8px;display:flex;align-items:center;justify-content:center;"><span style="font-size:12px;color:#888;">Loading QR...</span></div>' +
                    '<a href="' + url + '" target="_blank" style="font-size:12px;color:#5a8a6a;word-break:break-all;display:block;margin-bottom:16px;">' + url + '</a>' +
                    '<div id="ps-status" style="padding:10px;border-radius:8px;background:#f5f0e4;font-size:13px;font-weight:500;color:#854f0b;">\u23F3 Waiting for payment...</div>' +
                    '</div>'
            }],
            primary_action_label: "Confirm payment manually",
            primary_action: function() {
                clearInterval(pollTimer);
                d.hide();
                on_success();
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
                qrEl.innerHTML = '<img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=' +
                    encodeURIComponent(url) + '" style="width:200px;height:200px;border-radius:6px;" />';
            }
        }, 200);

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
                        setTimeout(function() { d.hide(); on_success(); }, 1500);
                    }
                }
            });
        }, 5000);

        d.onhide = function() { clearInterval(pollTimer); };
    }

    // Override frappe.call to intercept POS submit_invoice
    var _original_call = frappe.call.bind(frappe);
    frappe.call = function(opts) {
        var method = (typeof opts === 'object') ? opts.method : opts;

        // Intercept POS invoice submission
        if (method && (
            method.indexOf('make_payment_via_payment_order') !== -1 ||
            method.indexOf('submit_invoice') !== -1 ||
            method.indexOf('pos_invoice') !== -1 ||
            method.indexOf('create_payment_request') !== -1
        )) {
            if (is_paystack_selected()) {
                var amount = get_paystack_amount();
                var doc = cur_pos && cur_pos.frm && cur_pos.frm.doc;
                var invoice_name = doc && doc.name;
                var customer = doc && doc.customer;

                if (amount && invoice_name) {
                    get_customer_email(customer, function(email) {
                        start_paystack_flow(amount, email, invoice_name, function() {
                            _original_call(opts);
                        });
                    });
                    return;
                }
            }
        }

        return _original_call(opts);
    };

    // Also try direct Vue component override after POS loads
    frappe.after_ajax(function() {
        setTimeout(function() {
            try {
                // Try to hook into the POS Vue instance's submit method
                var posApp = document.querySelector('#app').__vue_app__;
                if (posApp) {
                    console.log("POS Vue app found - Paystack integration active");
                }
            } catch(e) {}
        }, 2000);
    });

})();
