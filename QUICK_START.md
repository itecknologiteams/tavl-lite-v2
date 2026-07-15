# 🚀 QUICK START GUIDE

## Installation (5 Minutes)

### Step 1: Navigate to Project
```bash
cd "/home/iteck/Dev_Projects/tavl lite/tavl-lite-v2"
```

### Step 2: Install Dependencies
```bash
npm install
```
⏱️ Takes 2-3 minutes. Makes coffee while waiting ☕

### Step 3: Configure Database
```bash
cp .env.example .env
nano .env
```

Update these:
```env
DB_SERVER=192.168.20.x    # Your SQL Server IP
DB_USER=your_username      # Your DB username
DB_PASSWORD=your_password  # Your DB password
```

### Step 4: Launch!
```bash
npm run electron:dev
```

🎉 **App opens automatically!**

---

## 🎯 What You'll See

### 1. Login Screen
- Beautiful glassmorphic design
- Animated particle background
- Smooth transitions

**Test Login:**
- Will connect to your MDVR API
- Username: (your MDVR credentials)
- Password: (your MDVR credentials)

### 2. Dashboard
Once logged in:
- **Top Bar**: Logo, notifications, user menu
- **Status Cards**: Vehicle counters (currently mock data)
- **Left Panel**: Vehicle list (will show your vehicles)
- **Center**: Interactive map
- **Right Panel**: Alarms (click bell icon)

---

## 🔌 Connect Real Data

### Update MDVR Credentials
Edit `src/services/mdvr-api.ts`:
```typescript
// Line 6 - Update your MDVR URL if different
private baseURL = 'http://mdvr.itecknologi.com:8080';
```

### Test Connection
The login screen will automatically:
1. Call MDVR login API
2. Get jsession token
3. Fetch user vehicles
4. Navigate to dashboard

---

## 🗺️ Next: Add Real Vehicles to Map

Edit `src/features/dashboard/components/MapContainer.tsx`:

Replace mock markers (line 35) with:
```typescript
useEffect(() => {
  // Fetch real vehicles
  const vehicles = useVehicleStore((state) => state.vehicles);
  
  vehicles.forEach((vehicle) => {
    if (vehicle.gpsData) {
      const marker = L.marker([
        vehicle.gpsData.latitude,
        vehicle.gpsData.longitude
      ]);
      markers.addLayer(marker);
    }
  });
}, [vehicles]);
```

---

## 📂 Key Files to Know

### Authentication
- `src/features/auth/LoginScreen.tsx` - Login UI
- `src/store/authStore.ts` - User session state

### Dashboard
- `src/features/dashboard/Dashboard.tsx` - Main layout
- `src/features/dashboard/components/` - All dashboard components

### APIs
- `src/services/mdvr-api.ts` - MDVR endpoints
- `src/services/gps-api.ts` - GPS Server endpoints
- `src/services/database.ts` - SQL queries

### State
- `src/store/authStore.ts` - Authentication
- `src/store/vehicleStore.ts` - Vehicles
- `src/store/alarmStore.ts` - Alarms

---

## 🎨 Customize Design

### Change Colors
Edit `tailwind.config.js`:
```javascript
colors: {
  primary: {
    500: '#YOUR_COLOR', // Main blue
  }
}
```

### Change Logo
Replace `public/icon.png` with your logo.

### Modify Animations
Edit `src/styles/glass.css` for animation speeds.

---

## 🐛 Troubleshooting

### Database Won't Connect
```bash
# Check SQL Server is running
# Verify IP in .env is correct
# Test with SQL Server Management Studio first
```

### Map Not Loading
```bash
# Check internet connection
# OpenStreetMap tiles need internet
# Check browser console (F12) for errors
```

### npm install Fails
```bash
# Try clearing npm cache
npm cache clean --force
rm -rf node_modules package-lock.json
npm install
```

---

## 📱 Development Tips

### Hot Reload
- Save any `.tsx` file
- Changes appear instantly
- No need to restart!

### Debug Mode
- Press **F12** in app
- Opens Chrome DevTools
- See console, network, React components

### Build for Production
```bash
npm run electron:build
# Creates .exe installer in release/ folder
```

---

## 🎯 Testing Checklist

- [ ] App starts successfully
- [ ] Login screen appears
- [ ] Can log in with credentials
- [ ] Dashboard loads
- [ ] Map displays
- [ ] Can toggle sidebars
- [ ] Status cards show numbers
- [ ] Animations are smooth

---

## 📞 Need Help?

**Common Issues:**
1. **"Module not found"** → Run `npm install` again
2. **"Database error"** → Check .env credentials
3. **"Port 5173 in use"** → Kill other Vite processes
4. **White screen** → Check browser console (F12)

**Resources:**
- 📖 Full README: `README.md`
- 📚 Setup Guide: `SETUP_GUIDE.md`
- 📊 Project Plan: `TAVL_LITE_2.0_PROJECT_PLAN.md`
- 📝 Summary: `PROJECT_SUMMARY.md`

---

## 🎉 You're Ready!

```bash
# Your new development workflow:
npm run electron:dev  # Start dev server
# Edit code
# See changes instantly
# Ship amazing software! 🚀
```

---

<div align="center">
  <h2>🎨 Happy Coding!</h2>
  <p>Built with ❤️ and cutting-edge tech</p>
  <p><strong>TAVL Lite 2.0 - The Future of Vehicle Tracking</strong></p>
</div>
