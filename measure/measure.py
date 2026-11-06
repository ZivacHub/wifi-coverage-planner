"""
Walk-and-measure Wi-Fi survey.

You walk around with a laptop. At each spot you type its name ("kitchen",
"basement door"...) and press Enter. The script then stands there for a few
seconds and records:
  - signal strength (RSSI, in dBm, e.g. -49 is strong, -80 is weak)
  - how many pings to the router got lost (packet loss, in %)
  - ping time (ms)

Results go to a CSV file that the floor-plan planner (planner/index.html)
can import, so the planner can match its estimate to real numbers.

Only the Python standard library is used. Works on Windows (netsh) and on
Linux (iw / nmcli). Run:  python measure/measure.py
"""

import argparse
import csv
import datetime as dt
import os
import platform
import re
import statistics
import subprocess
import sys
import time

# Where I would put the next device. Explained in README ("Why -75 dBm / 5 %").
WARN_RSSI = -75   # dBm: below this, start planning the next device
BAD_RSSI = -82    # dBm: below this, messages really start getting lost
WARN_LOSS = 5.0   # %: more lost pings than this = put the next device before here

IS_WINDOWS = platform.system() == "Windows"


# ---------------------------------------------------------------- reading Wi-Fi

def run(cmd, timeout=5):
    try:
        out = subprocess.run(cmd, capture_output=True, timeout=timeout,
                             shell=isinstance(cmd, str))
        return out.stdout.decode(errors="replace")
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return ""


def read_wifi_windows():
    txt = run(["netsh", "wlan", "show", "interfaces"])

    def field(name):
        m = re.search(r"^\s*" + name + r"\s*:\s*(.+?)\s*$", txt, re.M | re.I)
        return m.group(1) if m else None

    rssi = field("Rssi")
    signal_pct = field("Signal")
    info = {
        "ssid": field("SSID"),
        "bssid": field("AP BSSID") or field("BSSID"),
        "band": field("Band") or field("Radio type"),
        "channel": field("Channel"),
        "rssi": None,
    }
    if rssi and re.match(r"-?\d+", rssi):
        info["rssi"] = int(re.match(r"-?\d+", rssi).group(0))
    elif signal_pct:
        # Older Windows only shows a percentage. Rough conversion used by
        # many tools: 100 % ~ -50 dBm, 0 % ~ -100 dBm.
        pct = int(re.match(r"\d+", signal_pct).group(0))
        info["rssi"] = round(pct / 2 - 100)
        info["approx"] = True
    return info


def read_wifi_linux():
    txt = run("iw dev 2>/dev/null | awk '/Interface/{print $2}' | head -n1")
    iface = txt.strip()
    info = {"ssid": None, "bssid": None, "band": None, "channel": None, "rssi": None}
    if iface:
        link = run(["iw", "dev", iface, "link"])
        m = re.search(r"signal:\s*(-?\d+)", link)
        if m:
            info["rssi"] = int(m.group(1))
        m = re.search(r"SSID:\s*(.+)", link)
        info["ssid"] = m.group(1).strip() if m else None
        m = re.search(r"Connected to\s+([0-9a-f:]{17})", link, re.I)
        info["bssid"] = m.group(1) if m else None
        m = re.search(r"freq:\s*(\d+)", link)
        if m:
            info["band"] = "5 GHz" if int(m.group(1)) > 4000 else "2.4 GHz"
    if info["rssi"] is None:
        # nmcli fallback (percentage only)
        line = run("nmcli -t -f ACTIVE,SIGNAL,SSID dev wifi | grep '^yes'")
        parts = line.strip().split(":")
        if len(parts) >= 3 and parts[1].isdigit():
            info["rssi"] = round(int(parts[1]) / 2 - 100)
            info["ssid"] = parts[2]
            info["approx"] = True
    return info


def read_wifi():
    return read_wifi_windows() if IS_WINDOWS else read_wifi_linux()


def default_gateway():
    if IS_WINDOWS:
        out = run(["powershell", "-NoProfile", "-Command",
                   "(Get-NetRoute -DestinationPrefix '0.0.0.0/0' | "
                   "Sort-Object RouteMetric | Select-Object -First 1).NextHop"])
        ip = out.strip()
        if re.match(r"^\d+\.\d+\.\d+\.\d+$", ip):
            return ip
        out = run(["ipconfig"])
        m = re.search(r"Default Gateway[ .]*:\s*(\d+\.\d+\.\d+\.\d+)", out)
        return m.group(1) if m else None
    out = run("ip route | awk '/default/{print $3; exit}'")
    return out.strip() or None


def ping_once(host, timeout_ms=1000):
    """Returns ping time in ms, or None if the ping was lost."""
    if IS_WINDOWS:
        cmd = ["ping", "-n", "1", "-w", str(timeout_ms), host]
    else:
        cmd = ["ping", "-c", "1", "-W", str(max(1, timeout_ms // 1000)), host]
    t0 = time.perf_counter()
    out = run(cmd, timeout=timeout_ms / 1000 + 2)
    # "TTL=" appears only in a real reply (also on non-English Windows).
    if "ttl=" not in out.lower():
        return None
    m = re.search(r"(?:time|vrijeme|zeit)[=<]\s*([\d.,]+)\s*ms", out, re.I)
    if m:
        return float(m.group(1).replace(",", "."))
    return round((time.perf_counter() - t0) * 1000, 1)


# ---------------------------------------------------------------- fake mode

class FakeWifi:
    """For trying the script without walking around: signal drops a bit
    at every new spot, like walking away from the router."""

    def __init__(self):
        self.spot = 0

    def next_spot(self):
        self.spot += 1

    def read(self):
        import random
        base = -45 - self.spot * 7
        return {"ssid": "FAKE", "bssid": "00:00:00:00:00:00", "band": "5 GHz",
                "channel": "36", "rssi": base + random.randint(-3, 3)}

    def ping(self):
        import random
        rssi = -45 - self.spot * 7
        lose_chance = 0 if rssi > -70 else min(0.9, (-70 - rssi) * 0.03)
        return None if random.random() < lose_chance else round(random.uniform(2, 15), 1)


# ---------------------------------------------------------------- verdict

def verdict(rssi_median, loss_pct):
    if rssi_median is None:
        return "NO SIGNAL", "not connected here"
    if rssi_median < BAD_RSSI or loss_pct > 20:
        return "TOO WEAK", "the next device should already be BEFORE this spot"
    if rssi_median < WARN_RSSI or loss_pct > WARN_LOSS:
        return "PUT NEXT DEVICE HERE", "still works, but close to the edge"
    return "OK", "good signal"


def bar(rssi, width=30):
    if rssi is None:
        return ""
    # -30 dBm = full bar, -95 dBm = empty
    filled = max(0, min(width, round((rssi + 95) / 65 * width)))
    return "#" * filled + "." * (width - filled)


# ---------------------------------------------------------------- main loop

def measure_spot(name, seconds, target, fake):
    rssis, pings = [], []
    info = {}
    print(f"  measuring '{name}' for {seconds} s, stand still...")
    for i in range(seconds):
        t0 = time.time()
        info = fake.read() if fake else read_wifi()
        ms = fake.ping() if fake else (ping_once(target) if target else None)
        if info.get("rssi") is not None:
            rssis.append(info["rssi"])
        pings.append(ms)
        shown = f"{info.get('rssi')} dBm" if info.get("rssi") is not None else "no signal"
        p = f"{ms} ms" if ms is not None else "LOST"
        print(f"    {i + 1:>2}/{seconds}  {shown:>10}  ping {p}")
        time.sleep(max(0, 1 - (time.time() - t0)))

    lost = sum(1 for p in pings if p is None)
    loss_pct = round(100 * lost / len(pings), 1) if pings else 100.0
    ok_pings = [p for p in pings if p is not None]
    row = {
        "place": name,
        "rssi_median": round(statistics.median(rssis)) if rssis else "",
        "rssi_min": min(rssis) if rssis else "",
        "rssi_max": max(rssis) if rssis else "",
        "loss_pct": loss_pct,
        "ping_avg_ms": round(statistics.mean(ok_pings), 1) if ok_pings else "",
        "samples": len(pings),
        "ssid": info.get("ssid") or "",
        "bssid": info.get("bssid") or "",
        "band": info.get("band") or "",
        "channel": info.get("channel") or "",
        "time": dt.datetime.now().isoformat(timespec="seconds"),
    }
    label, why = verdict(row["rssi_median"] if rssis else None, loss_pct)
    row["verdict"] = label
    print(f"  -> {name}: median {row['rssi_median']} dBm, lost {loss_pct} %  =>  {label} ({why})\n")
    return row


def print_summary(rows):
    if not rows:
        return
    print("\nSUMMARY (in the order you walked)")
    print("-" * 78)
    w = max(len(r["place"]) for r in rows)
    first_warn = None
    for r in rows:
        rssi = r["rssi_median"] if r["rssi_median"] != "" else None
        print(f"{r['place']:<{w}}  {str(rssi):>5} dBm  {bar(rssi)}  lost {r['loss_pct']:>5} %  {r['verdict']}")
        if first_warn is None and r["verdict"] != "OK":
            first_warn = r
    print("-" * 78)
    if first_warn:
        idx = rows.index(first_warn)
        before = rows[idx - 1]["place"] if idx > 0 else None
        print(f"Next device: at '{first_warn['place']}'"
              + (f" (or between '{before}' and '{first_warn['place']}')" if before else "")
              + ".\nIt still has a connection there, so the new device can pick it up and pass it on.")
    else:
        print("Signal was OK everywhere you measured. No extra device needed on this path.")


def main():
    ap = argparse.ArgumentParser(description="Walk around and record Wi-Fi signal and packet loss per place.")
    ap.add_argument("-s", "--seconds", type=int, default=10, help="seconds to measure at each spot (default 10)")
    ap.add_argument("-t", "--target", help="what to ping (default: your router / default gateway)")
    ap.add_argument("-o", "--out", help="CSV file to write (default: measurements-<date>.csv)")
    ap.add_argument("--fake", action="store_true", help="no real Wi-Fi, made-up numbers (for trying it out)")
    args = ap.parse_args()

    fake = FakeWifi() if args.fake else None
    target = args.target or (None if fake else default_gateway())
    out = args.out or f"measurements-{dt.datetime.now():%Y-%m-%d_%H-%M}.csv"

    if not fake:
        info = read_wifi()
        if info.get("rssi") is None:
            print("Can't read Wi-Fi signal. Are you connected to Wi-Fi?")
            sys.exit(1)
        print(f"Connected to '{info.get('ssid')}' ({info.get('band')}, channel {info.get('channel')}), "
              f"signal now {info['rssi']} dBm" + (" (approx. from %)" if info.get("approx") else ""))
        if not target:
            print("Couldn't find the router address, packet loss won't be measured. Use --target 192.168.1.1")
    print(f"Pinging: {target or '-'}   |   saving to: {os.path.abspath(out)}")
    print("Type the name of the spot you're standing at and press Enter. Empty Enter = finish.\n")

    rows = []
    fields = ["place", "rssi_median", "rssi_min", "rssi_max", "loss_pct", "ping_avg_ms",
              "samples", "ssid", "bssid", "band", "channel", "time", "verdict"]
    try:
        while True:
            name = input("Spot name: ").replace("﻿", "").strip()
            if not name:
                break
            if fake and rows:
                fake.next_spot()
            rows.append(measure_spot(name, args.seconds, target, fake))
            # save after every spot, so nothing is lost if the laptop dies in the basement
            with open(out, "w", newline="", encoding="utf-8") as f:
                wr = csv.DictWriter(f, fieldnames=fields)
                wr.writeheader()
                wr.writerows(rows)
    except (KeyboardInterrupt, EOFError):
        print()
    print_summary(rows)
    if rows:
        print(f"\nSaved {len(rows)} spots to {os.path.abspath(out)}")
        print("Next: open planner/index.html, load your floor plan, Import measurements, and pin each spot.")


if __name__ == "__main__":
    main()
