import cv2
import numpy as np
import pyautogui
import easyocr
import ollama
import keyboard
import warnings

warnings.filterwarnings("ignore", category=UserWarning)

# Initialize OCR once
reader = easyocr.Reader(['en'], gpu=False)


def get_text_from_roi(img, contour):
    """Crops a contour region and extracts text cleanly."""
    x, y, w, h = cv2.boundingRect(contour)

    # Add a tiny padding to not cut off characters near edges
    padding = 5
    roi = img[
        max(0, y - padding):min(img.shape[0], y + h + padding),
        max(0, x - padding):min(img.shape[1], x + w + padding)
    ]

    if roi.size == 0:
        return ""

    # Run OCR on the isolated block
    results = reader.readtext(roi)
    text = " ".join([res[1] for res in results]).strip()
    return text


def extract_and_solve_hsv():
    print("\n📸 Capturing screen...")

    full_screenshot = pyautogui.screenshot()
    frame = cv2.cvtColor(np.array(full_screenshot), cv2.COLOR_RGB2BGR)

    # Convert to HSV color space for resilient color matching
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)

    # Define broad HSV ranges for Kahoot's signature colors
    # Adjust slightly if your monitor profile alters colors drastically
    color_ranges = {
        "Red": ((0, 150, 100), (10, 255, 255)),
        "Red2": ((170, 150, 100), (180, 255, 255)),
        "Blue": ((100, 150, 100), (140, 255, 255)),
        "Yellow": ((15, 150, 100), (35, 255, 255)),
        "Green": ((40, 100, 50), (85, 255, 255)),
        "White": ((0, 0, 200), (180, 30, 255))
    }

    extracted_data = {
        "Question": "",
        "Red": "",
        "Blue": "",
        "Yellow": "",
        "Green": ""
    }

    # 1. Isolate Answer Blocks via Contours
    for color, (lower, upper) in color_ranges.items():
        if color == "Red2":
            continue  # Handled together with Red

        if color == "Red":
            mask1 = cv2.inRange(
                hsv,
                np.array(color_ranges["Red"][0]),
                np.array(color_ranges["Red"][1])
            )
            mask2 = cv2.inRange(
                hsv,
                np.array(color_ranges["Red2"][0]),
                np.array(color_ranges["Red2"][1])
            )
            mask = cv2.bitwise_or(mask1, mask2)
        else:
            mask = cv2.inRange(
                hsv,
                np.array(lower),
                np.array(upper)
            )

        # Find structural blocks matching the color
        contours, _ = cv2.findContours(
            mask,
            cv2.RETR_EXTERNAL,
            cv2.CHAIN_APPROX_SIMPLE
        )

        # Filter contours by size to avoid tiny UI accents or icons
        valid_contours = [
            c for c in contours
            if cv2.contourArea(c) > 5000
        ]

        if valid_contours:
            # Pick the largest area block matching the color signature
            best_contour = max(valid_contours, key=cv2.contourArea)

            text = get_text_from_roi(frame, best_contour)

            # Cleanup list preserved from the historical development document.
            for icon in ["▲", "◆", "■", "●", "t", "a", "o", "v"]:
                text = text.replace(icon, "")

            if color == "White":
                # Kahoot often puts the question inside a white box,
                # or the background may vary.
                # If multiple large white boxes exist, the one with the most
                # text is likely our target.
                best_text = ""

                for c in valid_contours:
                    t = get_text_from_roi(frame, c)

                    if len(t) > len(best_text):
                        best_text = t

                extracted_data["Question"] = best_text
            else:
                extracted_data[color] = text.strip()

    print("\n--- Layout-Agnostic Extracted Game Text ---")
    print(
        f"Question: "
        f"{extracted_data['Question'] if extracted_data['Question'] else '[Fallback to Global OCR needed]'}"
    )

    for col in ["Red", "Blue", "Yellow", "Green"]:
        print(f"- {col}: {extracted_data[col]}")

    print("------------------------------------------\n")

    # Fallback:
    # If white box detection fails due to a custom theme background,
    # search the top half of the screen text for the question.
    if not extracted_data["Question"]:
        print("⚠️ White box query failed, activating top-screen fallback OCR...")

        h, w, _ = frame.shape
        top_slice = frame[0:int(h * 0.6), 0:w]

        res = reader.readtext(top_slice)

        # Combine longer text sentences while excluding system indicators
        q_elements = [
            r[1]
            for r in res
            if len(r[1]) > 10 and "kahoot" not in r[1].lower()
        ]

        if q_elements:
            extracted_data["Question"] = " ".join(q_elements)
            print(f"Fallback Question Found: {extracted_data['Question']}")

    if extracted_data["Question"]:
        ask_local_ai(
            extracted_data["Question"],
            extracted_data
        )
    else:
        print("❌ Could not cleanly isolate the question text.")


def ask_local_ai(question, choices_dict):
    prompt = f"""You are an expert multiple-choice solver. Analyze the following quiz question and select the single best option from the choices provided. Respond with ONLY the color label and the exact text of the correct answer. Do not explain your reasoning.

Question: {question}

Choices:
- Red: {choices_dict['Red']}
- Blue: {choices_dict['Blue']}
- Yellow: {choices_dict['Yellow']}
- Green: {choices_dict['Green']}

Correct Answer:"""

    print("🧠 Consulting local AI Engine...")

    try:
        response = ollama.generate(
            model='llama3',
            prompt=prompt,
            options={"num_thread": 4}
        )

        print("\n⚡ --- AI RECOMMENDED ANSWER --- ⚡")
        print(response['response'].strip())
        print("⚡ ------------------------------ ⚡\n")

    except Exception as e:
        print(f"AI Processing Error: {str(e)}")


print("System Active (Dynamic Color Segmentation Mode). Press Ctrl+Alt+T.")
keyboard.add_hotkey("ctrl+alt+t", extract_and_solve_hsv)
keyboard.wait()
