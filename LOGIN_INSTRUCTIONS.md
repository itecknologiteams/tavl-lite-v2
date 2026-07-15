# ✅ LOGIN INSTRUCTIONS - CORRECT BASE NAMES

## How to Login

### Login Fields:

1. **Username:** Your CRM username (e.g., `Anil`)
2. **Password:** Your CRM password (e.g., `Anil123`)
3. **Base Name(s):** Enter one or more base names: `base1`, `base2`, `base3`, ... up to `base9`

### Base Names:

The valid base names are:
- `base1`
- `base2`
- `base3`
- `base4`
- `base5`
- `base6`
- `base7`
- `base8`
- `base9`

You can enter:
- Single base: `base1`
- Multiple bases: `base1, base2` or `base1, base3, base5`

---

## Example Login:

### User: Anil
```
Username: Anil
Password: Anil123
Base Name: base1
```

### User with Multiple Bases:
```
Username: Anil
Password: Anil123
Base Name: base1, base2
```

---

## What Happens:

1. System validates your credentials in CRM database
2. System looks up LoginIds for the base names you entered (e.g., `base1` → LoginId)
3. System authenticates with MDVR
4. System loads ONLY vehicles assigned to those LoginIds
5. You see your filtered vehicles on the dashboard

---

## Common Mistakes:

❌ **WRONG:**
- Base Name: `Attock` (not a valid base name)
- Base Name: `DHL` (not a valid base name)
- Base Name: `Company1` (not a valid base name)

✅ **CORRECT:**
- Base Name: `base1`
- Base Name: `base2`
- Base Name: `base1, base2`

---

## Testing:

```bash
npm run electron:dev
```

**Try logging in with:**
```
Username: Anil
Password: Anil123
Base Name: base1
```

This should:
1. Validate your credentials
2. Get LoginId for `base1` from the database
3. Load vehicles assigned to that LoginId
4. Display them on the dashboard
