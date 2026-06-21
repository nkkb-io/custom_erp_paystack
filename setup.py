from setuptools import setup, find_packages

with open("requirements.txt") as f:
    install_requires = f.read().strip().split("\n")

setup(
    name="custom_erp_paystack",
    version="0.0.1",
    description="Paystack payment gateway integration for ERPNext POS",
    author="Eusol Organics",
    author_email="eusolghana@gmail.com",
    packages=find_packages(),
    zip_safe=False,
    include_package_data=True,
    install_requires=install_requires
)
