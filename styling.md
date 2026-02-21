# FireCommand: Tactical UI Styling Specifications

## 1. Visual Identity & Vibe
* [cite_start]**Theme Name:** Cyber-Noir Tactical Intelligence. [cite: 6]
* **Atmosphere:** High-stakes, high-contrast, and technical. [cite_start]The UI should look like a "Mission Control" center designed for zero-latency decision making. [cite: 15, 37]
* [cite_start]**Design Language:** Fictional User Interface (FUI) with an emphasis on surveillance overlays and real-time data visualization. [cite: 15, 28]

## 2. Color Palette: "Hazard & Void"
| Element | Hex Code | Visual Description |
| :--- | :--- | :--- |
| **Primary Background** | `#000000` | Pure Black "Void" to maximize contrast. |
| **Primary Accent** | `#FF3131` | "Signal Red" for all active targets, buttons, and status icons. |
| **Critical Alerts** | `#FF0000` | [cite_start]Intense Red for "Man Down" or life-critical warnings. [cite: 32] |
| **Muted UI/Borders** | `#1A1A1A` | Dark Charcoal for panel containers and grid lines. |
| **Subtle Accents** | `#4D1010` | "Dim Red" for inactive or background structural elements. |
| **Data & Logs** | `#A0A0A0` | Neutral Grey for secondary telemetry and timestamps. |
| **Highlight Text** | `#FFFFFF` | Pure White for primary data values and active headers. |

## 3. Typography
* [cite_start]**Headings (Display):** Use wide, geometric sans-serif fonts (e.g., Orbitron, Michroma, or Oxanium). [cite: 27]
    * *Styling:* All-caps, slightly letter-spaced.
* [cite_start]**Data & Logistics (Mono):** Use high-readability monospaced fonts (e.g., JetBrains Mono, Space Mono). [cite: 26, 27]
    * [cite_start]*Styling:* Used for GPS coordinates, air supply percentages, and radio transcripts. [cite: 24, 31, 32]

## 4. Visual Elements & FX
* **Tactical Grid:** A faint background dot or square grid (30px spacing) across the entire dashboard to convey spatial scale.
* **L-Brackets:** Use corner "L" brackets instead of solid boxes for panels to create a HUD (Heads-Up Display) feel.
* **The Glow:** Apply a subtle red outer glow to any "Signal Red" element to simulate a light-emitting screen.
* [cite_start]**Surveillance Scanlines:** Add a low-opacity horizontal line overlay (scanlines) to all body-cam video feeds to emphasize the "live" tactical stream. [cite: 31]

## 5. Component Guidelines

### [cite_start]A. Live Floor Map [cite: 28]
* [cite_start]**Styling:** Deep black map base with a tactical grid. [cite: 23]
* [cite_start]**Unit Indicators:** Each firefighter is a colored icon with a glowing breadcrumb trail showing their path. [cite: 29, 30]
* **Room Status:** Shaded red areas represent "cleared" rooms; unknown areas remain dark.

### [cite_start]B. Unit Status Sidebar [cite: 28]
* [cite_start]**Information:** Displays real-time position, status, and SCBA air supply. [cite: 32]
* **Status Logic:**
    * **Normal:** White/Grey text.
    * [cite_start]**Warning (Stationary > 45s):** Yellow text and border. [cite: 32]
    * [cite_start]**Alert (Stationary > 90s):** Flashing Signal Red with "RED ALERT" banner. [cite: 32]

### [cite_start]C. Body-Cam Panels [cite: 31]
* **Frame:** Use tactical corner brackets.
* [cite_start]**AI Overlays:** Small, black-on-red badges in the top-left corner showing smoke density or room classification (e.g., "KITCHEN"). [cite: 32]

### D. Radio Transcript
* **Styling:** Scrolling terminal-style list.
* **Format:** `[TIMESTAMP] UNIT_ID > MESSAGE`.
* **Interaction:** A "Mic" icon for the dispatcher to communicate back to the team.

## 6. Layout Rules (Next.js/Tailwind)
* **Container:** Full-screen (`h-screen`), non-scrollable dashboard.
* **Grid:** 4-panel layout:
    1.  [cite_start]**Top Center:** Live Map (Main focus). [cite: 28]
    2.  [cite_start]**Right Sidebar:** Unit Status & Air Supply. [cite: 28, 31]
    3.  [cite_start]**Bottom Left:** Body-cam feeds (FF1, FF2, etc.). [cite: 31]
    4.  [cite_start]**Bottom Right:** Radio Transcript / AI Alerts. [cite: 32]

## 7. Styling
Make sure to use next.js, tailwind, anime.js, and any other component styling to ensure the product looks nice and handles all animations + functionality smoothly. Most importantly, make sure the three.js is functioning and taking in the colored point cloud properly. the point cloud on the frontend needs to be in color and with good functionality such as moving around too.
