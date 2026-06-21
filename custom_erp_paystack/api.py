import frappe
import requests
import hashlib
import hmac
import json


def get_settings():
    settings = frappe.get_single("Paystack Settings")
    return settings


@frappe.whitelist()
def initialize_payment(email, amount, reference, invoice_name=None):
    """
    Initialize a Paystack transaction and return the authorization URL.
    amount should be in the base currency unit (e.g. GHS), will be converted to kobo/pesewas.
    """
    settings = get_settings()
    if not settings.enabled:
        frappe.throw("Paystack payments are not enabled")

    secret_key = settings.get_password("secret_key")

    url = "https://api.paystack.co/transaction/initialize"
    headers = {
        "Authorization": f"Bearer {secret_key}",
        "Content-Type": "application/json"
    }
    payload = {
        "email": email,
        "amount": int(float(amount) * 100),  # convert to kobo/pesewas
        "reference": reference,
        "callback_url": settings.callback_url or frappe.utils.get_url(),
        "metadata": {
            "invoice_name": invoice_name,
            "custom_fields": []
        }
    }

    response = requests.post(url, headers=headers, json=payload)
    data = response.json()

    if not data.get("status"):
        frappe.throw(f"Paystack initialization failed: {data.get('message')}")

    # Log the transaction attempt
    log = frappe.get_doc({
        "doctype": "Paystack Transaction Log",
        "reference": reference,
        "invoice": invoice_name,
        "email": email,
        "amount": amount,
        "status": "Pending",
        "authorization_url": data["data"]["authorization_url"],
        "access_code": data["data"]["access_code"]
    })
    log.insert(ignore_permissions=True)
    frappe.db.commit()

    return {
        "authorization_url": data["data"]["authorization_url"],
        "access_code": data["data"]
