import time
import network
import urequests
from presto import Presto
import gc
try:
    from secrets import WIFI_SSID, WIFI_PASS, AGENT_SERVER_IP
except ImportError:
    print("Please create a secrets.py file")
    raise

# --- CONFIGURATION ---
AGENT_PORT = 8080
POLL_INTERVAL = 3000
NETWORK_TIMEOUT = 3 

# --- SETUP ---
p = Presto()
display = p.display
width, height = display.get_bounds()

# Colors
BLACK = display.create_pen(0, 0, 0)
WHITE = display.create_pen(255, 255, 255)
GREEN = display.create_pen(50, 205, 50)
RED   = display.create_pen(255, 60, 60)
GRAY  = display.create_pen(100, 100, 100)
BLUE  = display.create_pen(0, 100, 255)

BASE_URL = "http://{}:{}".format(AGENT_SERVER_IP, AGENT_PORT)

def draw_ui(state, message=""):
    display.set_pen(BLACK)
    display.clear()
    
    cx, cy = width // 2, height // 2 - 40
    radius = 90
    
    # Pick Color
    if state == "listening" or state == "started":
        display.set_pen(GREEN)
        lbl = "ACTIVE"
    elif state == "offline":
        display.set_pen(RED)
        lbl = "OFFLINE"
    elif state == "init":
        display.set_pen(BLUE)
        lbl = "STARTING"
    else:
        display.set_pen(GRAY)
        lbl = "IDLE"
        
    display.circle(cx, cy, radius)
    
    # Label inside circle
    display.set_pen(WHITE)
    w = display.measure_text(lbl, 4)
    display.text(lbl, cx - (w // 2), cy - 15, width, 4)
    
    # Debug message at bottom
    if message:
        display.set_pen(WHITE)
        display.text(message, 10, height - 40, width, 2)
        
    p.update()

def connect_wifi():
    wlan = network.WLAN(network.STA_IF)
    wlan.active(True)
    if not wlan.isconnected():
        print("Connecting WiFi...")
        draw_ui("init", "Connecting WiFi...")
        wlan.connect(WIFI_SSID, WIFI_PASS)
        
        # Timeout safety (15 seconds)
        max_wait = 15
        while max_wait > 0:
            if wlan.isconnected():
                print("WiFi Connected:", wlan.ifconfig())
                return True
            time.sleep(1)
            max_wait -= 1
            
        print("WiFi Timeout")
        return False
    return True

def get_server_status():
    try:
        response = urequests.get(BASE_URL + "/status", timeout=NETWORK_TIMEOUT)
        data = response.json()
        response.close()
        return data.get("sessionState", "offline")
    except Exception as e:
        # print("Status error:", e) 
        return "offline"

def send_toggle(target_state):
    endpoint = "/stop" if target_state in ["listening", "started"] else "/start"
    try:
        urequests.post(BASE_URL + endpoint, timeout=NETWORK_TIMEOUT).close()
    except Exception as e:
        print("Toggle error:", e)

def main():
    # 1. Draw immediately to prove screen works
    draw_ui("init", "Booting...")
    time.sleep(1)
    
    # 2. Connect with Retry
    while not connect_wifi():
        draw_ui("offline", "WiFi Failed. Retrying...")
        time.sleep(3)

    # 3. Main Loop
    current_state = "offline" 
    last_poll = 0
    
    while True:
        # --- FIXED TOUCH LOGIC ---
        p.touch.poll()
        
        if p.touch.state:
            print("Touched!")
            
            # Visual Feedback FIRST
            draw_ui(current_state, "Sending command...")
            
            # Send Command
            send_toggle(current_state)
            
            # Debounce
            while p.touch.state:
                p.touch.poll() 
                time.sleep(0.1)
                
            # Force immediate refresh
            last_poll = 0 
            
        # --- STATUS LOGIC ---
        now = time.ticks_ms()
        if time.ticks_diff(now, last_poll) > POLL_INTERVAL:
            new_state = get_server_status()
            
            if new_state != current_state:
                current_state = new_state
                draw_ui(current_state, f"State: {current_state}")
                gc.collect() # Only collect garbage on state change
            
            last_poll = now
            
        time.sleep(0.05)

if __name__ == "__main__":
    main()
