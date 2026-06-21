// ── Eusol Organics — Paystack POS Integration ──
frappe.provide("custom_erp_paystack");

custom_erp_paystack.add_paystack_button = function() {
    // Wait for the POS payment screen to render
    var observer = new MutationObserver(function() {
        var payment_section = document.querySelector(".pos-payment-container, .payment-container");
        if (payment_section && !document.getElementById("paystack-pay-btn")) {
            inject_paystack_button(payment_section);
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
};

function inject_paystack_button(container) {
    var btn = document.createElement("button");
    btn.id = "paystack-pay-btn";
    btn.className = "btn btn-primary btn-sm";
    btn.style.cssText = "margin: 8px 0; width: 100%; background: #00C3F7; border-color: #00C3F7;";
    btn.innerHTML = "Pay with Paystack";
    btn.onclick = function(e) {
        e.preventDefault();
        start_paystack_payment();
    };
    container.appendChild(btn);
}

function start_paystack_payment() {
    var pos = cur_pos || (frappe.ui && frappe.ui.pos);
    if (!pos || !pos.frm) {
        frappe.msgprint("Could not detect active POS invoice.");
        return;
    }

    var doc = pos.frm.doc;
    var amount = doc.grand_total;
    var customer_email = "";

    if (doc.customer) {
        frappe.db.get_value("Customer", doc.customer, "email_id").then(function(r) {
            customer_email = (r.message && r.message.email_id) || "guest@eusolgh.com";
            initialize_and_redirect(amount, customer_email, doc.name);
        });
    } else {
        initialize_and_redirect(amount, "guest@eusolgh.com", doc.name);
    }
}

function initialize_and_redirect(amount, email, invoice_name) {
    var reference = "EUSOL-" + invoice_name + "-" + Date.now();

    frappe.call({
        method: "custom_erp_paystack.api.initialize_payment",
        args: {
            email: email,
            amount: amount,
            reference: reference,
            invoice_name: invoice_name
        },
        callback: function(r) {
            if (r.message && r.message.authorization_url) {
                show_paystack_qr_dialog(r.message.authorization_url, reference, invoice_name);
            }
        },
        error: function() {
            frappe.msgprint("Failed to start Paystack payment. Please try again.");
        }
    });
}

function show_paystack_qr_dialog(url, reference, invoice_name) {
    var d = new frappe.ui.Dialog({
        title: "Pay with Paystack",
        fields: [
            {
                fieldtype: "HTML",
                fieldname: "qr_html",
                options: '<div style="text-align:center; padding: 16px;">' +
                    '<div id="paystack-qr-code" style="margin: 0 auto 16px;"></div>' +
                    '<p style="font-size: 12px; color: #888;">Ask the customer to scan this QR code or open the link below to pay.</p>' +
                    '<a href="' + url + '" target="_blank" style="font-size: 12px; word-break: break-all;">' + url + '</a>' +
                    '<p id="paystack-status" style="margin-top: 16px; font-weight: 500; color: #c9a84c;">Waiting for payment...</p>' +
                    '</div>'
            }
        ]
    });
    d.show();

    // Generate QR code using a public QR API (no extra dependency needed)
    setTimeout(function() {
        var qrContainer = document.getElementById("paystack-qr-code");
        if (qrContainer) {
            var img = document.createElement("img");
            img.src = "https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=" + encodeURIComponent(url);
            img.style.cssText = "width: 200px; height: 200px;";
            qrContainer.appendChild(img);
        }
    }, 100);

    // Poll for payment confirmation every 4 seconds
    var pollInterval = setInterval(function() {
        frappe.call({
            method: "custom_erp_paystack.api.verify_payment",
            args: { reference: reference },
            callback: function(r) {
                if (r.message && r.message.status === "success") {
                    clearInterval(pollInterval);
                    var statusEl = document.getElementById("paystack-status");
                    if (statusEl) {
                        statusEl.textContent = "Payment confirmed!";
                        statusEl.style.color = "#3b6d11";
                    }
                    setTimeout(function() {
                        d.hide();
                        frappe.show_alert({ message: "Paystack payment confirmed", indicator: "green" });
                        // Refresh POS to reflect payment
                        if (cur_pos) cur_pos.refresh();
                    }, 1200);
                }
            }
        });
    }, 4000);

    d.onhide = function() {
        clearInterval(pollInterval);
    };
}

frappe.ready(function() {
    custom_erp_paystack.add_paystack_button();
});
