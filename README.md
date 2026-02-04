Pulse is a modern React Native (Expo) based social media application featuring real-time chat, reels, profiles, notifications, and a smooth mobile-first UI.
It’s designed with scalability, performance, and clean architecture in mind.

📱 Features

🔥 Reels-style video feed

💬 Real-time chat & messaging

👤 User profiles & editing

🔔 Notifications system

🧠 Clean UI with reusable components

⚡ Fast performance using optimized rendering

🌐 API & Socket integration

🎨 Consistent theming & safe area support

🧠 Tech Stack
Frontend

React Native (Expo)

JavaScript

Expo Router

Custom UI Components

SafeAreaView support

Backend / Services

REST APIs

WebSocket (real-time chat)

External API integration

Tools

Expo CLI

Git & GitHub

EAS Build

Axios

📂 Project Structure
Pulse/
│
├── App.js
├── index.js
├── app.json
├── eas.json
├── package.json
│
├── assets/
│   ├── icons
│   ├── splash
│
├── src/
│   ├── components/
│   ├── screens/
│   │   ├── Auth/
│   │   ├── Chat/
│   │   ├── Home/
│   │   ├── Profile/
│   │   ├── Reels/
│   │   └── Search/
│   │
│   ├── services/
│   │   ├── api.js
│   │   ├── socket.js
│   │   └── gifService.js
│   │
│   ├── styles/
│   │   ├── theme.js
│   │   └── SafeAreaStyles.js
│
└── README.md

⚙️ Installation & Setup
1️⃣ Clone Repository
git clone https://github.com/your-username/pulse.git
cd pulse

2️⃣ Install Dependencies
npm install

3️⃣ Start Expo Server
npx expo start

📱 Run on Device

Install Expo Go from Play Store / App Store

Scan QR Code from terminal

App will run instantly

🔌 Environment Setup

Create a .env file if needed:

API_BASE_URL=your_api_url
SOCKET_URL=your_socket_url

✨ Key Highlights

Modular screen-based structure

Reusable components

Real-time socket connection

Clean UI/UX

Optimized for performance

Ready for production scaling

🚀 Future Enhancements

🔐 Authentication with OTP

🧵 Comment & Like system

📹 Video upload support

🧑‍🤝‍🧑 Followers & Following

🌙 Dark mode

🔔 Push notifications

👨‍💻 Author

Rajveer Shekhawat
🚀 Full Stack & Mobile App Developer

📄 License

This project is licensed under the MIT License.