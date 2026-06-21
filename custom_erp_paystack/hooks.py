app_name = "custom_erp_paystack"
app_title = "Eusol Paystack"
app_publisher = "Eusol Organics"
app_description = "Paystack payment gateway integration for ERPNext POS"
app_email = "eusolghana@gmail.com"
app_license = "MIT"

# Whitelisted webhook endpoint for Paystack callbacks
# Accessible at: /api/method/custom_erp_paystack.api.paystack_webhook

# Include JS in POS / Selling workspace
app_include_js = [
    "/assets/custom_erp_paystack/js/pos_paystack.js"
]
