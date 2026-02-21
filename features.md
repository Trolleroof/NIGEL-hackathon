# FireCommand: Future Interface for Firefighter Dispatch 

## 1. System Overview
[cite_start]FireCommand is an intelligent "Mission Control" interface that transforms raw VSLAM (Visual Simultaneous Localization and Mapping) and radio chatter into a real-time, 3D tactical floor plan[cite: 6, 14]. Designed for the **Future Interfaces** hackathon, it modernizes traditional fire dispatch by creating a multi-modal agent that "understands" the mission context.

---

## 2. UI Architecture (The Dispatcher Dashboard)

### **A. Left Panel: Multi-Unit Viewports**
* **Capacity:** 6 simultaneous unit feeds.
* **Feed Sources:** * **Unit 1 (Live):** Real-time RGB/Lidar stream from the **Odin1** helmet/chest rig.
    * **Units 2-6 (Simulated):** High-fidelity firefighter footage (YouTube/local files) to demonstrate scalability.
* **Interface Interaction:** * **Expansion Logic:** Each viewport features an "Expand" icon (diagonal arrows).
    * **Focus Mode:** Expanding a view triggers a "Lightbox" effect, dimming the background to prioritize the specific unit's feed.

### **B. Center Panel: Spatial Intelligence Hub**
* **Primary 3D Map:** A high-fidelity, real-time map rendered via **Three.js**.
    * **Data Input:** VSLAM RGB-colored point clouds streamed from the Odin1 via **rosbridge** or **WebSockets**.
    * **Visualization:** The point cloud dynamically renders the room geometry as the firefighter explores it.
* **Tactical Blueprint Integration (Bottom Center):**
    * **Search Interface:** An expandable "Address + Floor Plan Search" box.
    * **Reference Gallery:** A sideways-scrolling list of 5–7 pre-loaded blueprints for demo purposes.

### **C. Header: Tactical Metadata**
* **Temporal Tracking:** Live "Current Time" and "Operation Duration" counters.
* **Environmental API:** Real-time integration with a weather API to display temperature, humidity, and external conditions.

### **D. Right Panel: Semantic Radio Hub**
* **Communication Interface:** A microphone button for dispatcher-to-field voice transmission.
* **Intelligent Transcript:** A scrollable radio feed that processes audio through a Speech-to-Text (STT) agent.

---

## 3. Key Dynamic Features

### **Feature 1: Semantic Radio (Multi-Modal Agent)**
This is the core "Future Interface" innovation. The radio is no longer just a log; it is an active participant.
* **Spatial-Voice Integration:** An AI agent parses the transcript for location-based keywords.
* **Dynamic Annotation:** If a firefighter says, *"Heavy smoke in northeast kitchen,"* the UI automatically:
    1.  Drops a **Hazard Marker** icon on the specific 3D coordinates in the Three.js map.
    2.  Highlights the relevant transcript segment in the sidebar.
* **Stress Escalation:** Detection of high-stress keywords (e.g., "Bomb," "Collapse," "Mayday") triggers a global UI alert state.

### [cite_start]**Feature 2: Real-Time VSLAM Map Fusion** [cite: 14, 25]
* [cite_start]**Live Reconstruction:** The Odin1 builds an occupancy grid and point cloud on the fly[cite: 24, 25].
* [cite_start]**Relocalization:** If connectivity is lost, **MindSLAM** persists the map data, allowing the unit to "snap" back into position upon reconnection[cite: 33].

### [cite_start]**Feature 3: Safety Monitoring (Stretch Goal)** [cite: 32]
* [cite_start]**Fall Detection:** IMU sensors detect sudden orientation changes followed by lack of motion, triggering a "Man Down" banner[cite: 25, 32].
* [cite_start]**Status Indicators:** Units are color-coded (Active/Stationary/Down) based on real-time sensor telemetry[cite: 32].

---

## 4. Technical Stack
* [cite_start]**Hardware:** Odin1 Sensor Rig[cite: 13, 36].
* [cite_start]**Robotics:** ROS1 (Odin1 side), **foxglove_bridge** (WebSocket streaming)[cite: 26, 27].
* **Frontend:** React (UI Framework), **Three.js** (3D Point Cloud), **roslibjs** (ROS integration).
* **AI/Voice:** OpenAI Whisper (STT) or ElevenLabs (Voice Integration) for Semantic Radio.
