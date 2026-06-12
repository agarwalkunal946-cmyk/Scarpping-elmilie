import sys
import zipfile
import xml.etree.ElementTree as ET


XLSX_PATH = "/private/tmp/exim-export-test.xlsx"
CSV_PATH = "/private/tmp/exim-export-test.csv"
EXPECTED_COLUMNS = ["HSN Code", "Website Name", "Website URL", "Email", "Phone"]
BLOCKED_COLUMNS = ["Consignee", "Exporter", "Product Description", "Country", "Quantity", "FOB Value"]


def read_zip_text(zf, name):
    return zf.read(name).decode("utf-8")


def validate_xlsx():
    with zipfile.ZipFile(XLSX_PATH) as zf:
        names = set(zf.namelist())
        required = {
            "[Content_Types].xml",
            "xl/workbook.xml",
            "xl/worksheets/sheet1.xml",
            "xl/worksheets/_rels/sheet1.xml.rels",
            "xl/styles.xml",
            "xl/_rels/workbook.xml.rels",
        }
        missing = required - names
        if missing:
            raise AssertionError(f"Missing xlsx parts: {sorted(missing)}")

        sheet = read_zip_text(zf, "xl/worksheets/sheet1.xml")
        for expected in EXPECTED_COLUMNS + [
            "Rabelink Logistics",
            "https://rabelink.nl/",
            "info@rabelink.nl",
            "+31 314 368 500",
        ]:
            if expected not in sheet:
                raise AssertionError(f"Missing worksheet value: {expected}")
        for blocked in BLOCKED_COLUMNS + ["Select Row", "Wrong Shifted Company", "google.com/search"]:
            if blocked in sheet:
                raise AssertionError(f"Unexpected worksheet value: {blocked}")

        rels = read_zip_text(zf, "xl/worksheets/_rels/sheet1.xml.rels")
        if "https://rabelink.nl/" not in rels:
            raise AssertionError("Website URL hyperlink is missing")
        if "google.com/search" in rels:
            raise AssertionError("Google search query leaked into workbook hyperlinks")

        ET.fromstring(sheet)
        ET.fromstring(rels)


def validate_csv():
    with open(CSV_PATH, "r", encoding="utf-8-sig") as handle:
        csv_text = handle.read()
    expected_header = ",".join(EXPECTED_COLUMNS)
    if not csv_text.startswith(expected_header):
        raise AssertionError(f"Unexpected CSV header: {csv_text.splitlines()[0]}")
    for expected in [
        "Rabelink Logistics",
        "https://rabelink.nl/",
        "info@rabelink.nl",
        "+31 314 368 500",
    ]:
        if expected not in csv_text:
            raise AssertionError(f"Missing CSV value: {expected}")
    for blocked in BLOCKED_COLUMNS + ["Select Row", "Wrong Shifted Company", "google.com/search"]:
        if blocked in csv_text:
            raise AssertionError(f"Unexpected CSV value: {blocked}")


if __name__ == "__main__":
    try:
        validate_xlsx()
        validate_csv()
    except Exception as exc:
        print(f"Export validation failed: {exc}", file=sys.stderr)
        sys.exit(1)
    print("Python export validation passed")
