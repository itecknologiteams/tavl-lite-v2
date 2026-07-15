# Database Credentials - Source Documentation

## Investigation Summary

**Task:** Extract database credentials from Python application  
**Result:** ✅ Successfully found complete credentials  
**Date:** 2026-01-24

---

## Credentials Found

### 1. TAVL Database (Primary - Main Application)

**Location:** `dist/TDD Tracking Panel/config.json`  
**Lines:** 4-9

```json
"TAVL":{
    "DB": {
        "IP":"192.168.20.253",
        "User":"developer",
        "Password":"tavldev123",
        "DB":"tavl2",
        "Driver":"{ODBC Driver 17 for SQL Server}"
    }
}
```

**Connection String:**
```
DRIVER={ODBC Driver 17 for SQL Server};SERVER=192.168.20.253;DATABASE=tavl2;UID=developer;PWD=tavldev123
```

---

### 2. CRM/ERP Database (Secondary - for CRM/Vehicle Details)

**Location 1:** `dist/TDD Tracking Panel/config.json`  
**Lines:** 17-23

```json
"CRM":{
    "DB": {
        "IP":"192.168.21.33",
        "User":"crm",
        "Password":"sadoIOJDDAS03209203@$#%",
        "DB":"ERP_Tracking",
        "Driver":"{ODBC Driver 17 for SQL Server}"
    }
}
```

**Location 2 (Hardcoded Backup):** `TDD Tracking Panel.py`  
**Lines:** 7085-7088

```python
server = '192.168.21.33'
database = 'ERP_Tracking'
username = 'crm'
password = 'sadoIOJDDAS03209203@$#%'
```

**Connection String:**
```
DRIVER={ODBC Driver 17 for SQL Server};SERVER=192.168.21.33;DATABASE=ERP_Tracking;UID=crm;PWD=sadoIOJDDAS03209203@$#%
```

---

## Database Usage in Python App

### TAVL Database (`192.168.20.253` / `tavl2`)
Used for:
- **Geofences/Zones:** `[tavl2].[tavl].[Zone]`
- **Vehicle Commands:** `[tavl2].[dbo].[to_be_sent]`
- **Alarms/Events:** Event closure tracking
- **User Management:** User-vehicle associations
- **Configuration:** Application settings

**Example Queries Found:**
```sql
-- Line 493: Geofence query
SELECT name FROM [tavl2].[tavl].[Zone] Z 
WHERE Z.Enabled = '1' AND Z.Type=2 AND Z.Deleted = '0' 
GROUP BY Name

-- Line 2499: Vehicle commands
SELECT * FROM [tavl2].[dbo].[to_be_sent] 
WHERE sim_number='...' AND message='...'
```

### CRM Database (`192.168.21.33` / `ERP_Tracking`)
Used for:
- **Vehicle Details:** `[ERP_Tracking].[dbo].[VehiclesDetails]`
- **CRM Information:** Customer/contract data
- **Extended Vehicle Info:** Registration, ownership, etc.

**Example Queries Found:**
```sql
-- Line 7095: Vehicle CRM details
SELECT * FROM [ERP_Tracking].[dbo].[VehiclesDetails] with (NOLOCK)
WHERE [OBJECTID] = ...
```

---

## How Credentials Were Found

### Investigation Steps:

1. **Searched for database connections:**
   ```bash
   grep "pyodbc.connect" TDD\ Tracking\ Panel.py
   ```
   Found 64 connection instances

2. **Searched for IP addresses:**
   ```bash
   grep "192.168.(20|21)." TDD\ Tracking\ Panel.py
   ```
   Found server IPs: `192.168.21.33`, `192.168.20.253`

3. **Located config file:**
   ```bash
   find . -name "config.json"
   ```
   Found complete config: `dist/TDD Tracking Panel/config.json`

4. **Extracted credentials:**
   - Read `config.json` - found TAVL and CRM database sections
   - Read Python code - confirmed hardcoded credentials match

---

## Application Configuration Files

### Files Checked:

1. ✅ **`dist/TDD Tracking Panel/config.json`**
   - **Complete configuration** ✨
   - Contains TAVL DB credentials
   - Contains CRM DB credentials
   - Contains all API endpoints
   - Contains alarm descriptions

2. ⚠️ **`src/main/assets/config.json`**
   - Incomplete (missing DB sections)
   - Only has API endpoints and local paths

3. ✅ **`TDD Tracking Panel.py`**
   - Uses config.json for credentials
   - Line 7085-7088: Hardcoded CRM credentials as backup
   - Line 42-43: Loads config.json

---

## Applied to New Application

### Updated File: `tavl-lite-v2/.env`

```env
DB_SERVER=192.168.20.253
DB_NAME=tavl2
DB_USER=developer
DB_PASSWORD=tavldev123
DB_DRIVER=ODBC Driver 17 for SQL Server
```

### Why This Server?

**Primary Server:** `192.168.20.253` (TAVL database)
- Used in most of the application (~90% of queries)
- Contains main application data
- Has geofences, commands, events, alarms

**Secondary Server:** `192.168.21.33` (CRM database)
- Only used for specific CRM queries
- Contains extended vehicle information
- Commented out in .env (can switch if needed)

---

## Database Drivers Available

The Python app shows these drivers are used:
- `{ODBC Driver 17 for SQL Server}` (most common)
- `ODBC Driver 17 for SQL Server` (without braces, line 7090)

Our Node.js app uses the `mssql` package which handles this automatically.

---

## Security Notes

⚠️ **Important:**
- These credentials were found in the Python app's config files
- The Python app stores them in **plain text**
- The new Electron app uses `.env` file (gitignored)
- Never commit `.env` to version control
- Consider rotating passwords after migration

---

## Verification

To verify the credentials work:

```bash
cd tavl-lite-v2
npm run electron:dev
```

Look for:
```
🔧 Database Config: { server: '192.168.20.253', database: 'tavl2', user: 'developer', password: '***' }
✅ Database connected successfully
```

---

## Summary

| Database | Server | Database Name | User | Status |
|----------|--------|---------------|------|--------|
| **TAVL (Primary)** | 192.168.20.253 | tavl2 | developer | ✅ Configured |
| **CRM (Secondary)** | 192.168.21.33 | ERP_Tracking | crm | 📝 Available |

**All credentials successfully extracted and applied to new application!** 🎉
