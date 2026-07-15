# 🎯 Quick Reference - Database Configuration

## Current Configuration (Applied)

```env
DB_SERVER=192.168.20.253
DB_NAME=tavl2
DB_USER=developer
DB_PASSWORD=tavldev123
```

## Run the App

```bash
cd tavl-lite-v2
npm run electron:dev
```

## Expected Console Output

```
🔧 Database Config: {
  server: '192.168.20.253',
  database: 'tavl2',
  user: 'developer',
  password: '***'
}
✅ Database connected successfully
```

## Alternative Configuration (CRM Database)

If you need to switch to the CRM database, edit `.env`:

```env
DB_SERVER=192.168.21.33
DB_NAME=ERP_Tracking
DB_USER=crm
DB_PASSWORD=sadoIOJDDAS03209203@$#%
```

## Troubleshooting

### If connection fails:

1. **Check network access:** Can you reach the server?
   ```bash
   ping 192.168.20.253
   ```

2. **Check SQL Server port:** Default is 1433
   ```bash
   telnet 192.168.20.253 1433
   ```

3. **Verify credentials:** Make sure `.env` file has no typos

4. **Check driver:** Ensure ODBC Driver 17 for SQL Server is installed
   ```bash
   odbcinst -q -d
   ```

### If app starts but database features don't work:

This is expected! The app is designed to run without database connection.
- ✅ Login will work (uses MDVR API)
- ✅ Vehicle list will work (uses MDVR API)
- ✅ Map will work (uses MDVR API)
- ⚠️ Alarms will be limited (needs database)

## Documentation Files Created

1. `DB_CREDENTIALS_CONFIGURED.md` - Summary of what was found
2. `DATABASE_CREDENTIALS_SOURCE.md` - Detailed source documentation
3. `DATABASE_FIX.md` - How dotenv was added
4. `QUICK_REFERENCE.md` - This file

## Success Indicators

✅ App starts without crashing  
✅ Database config is logged  
✅ Login screen appears  
✅ Can login with MDVR credentials  
✅ Vehicle list loads  
✅ Map displays with markers  
✅ Alarms panel works  

---

**Everything is ready!** 🚀

Just run: `npm run electron:dev`
