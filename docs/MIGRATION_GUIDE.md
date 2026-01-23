# Quick Migration Guide

## Transfer Your Existing Articles to Firebase

Follow these steps to migrate all your current PostgreSQL articles to Firebase Firestore:

### Step 1: Set Up Firebase (5 minutes)

**Important: Do this FIRST before running the migration!**

1. **Create Firebase Project:**
   - Go to https://console.firebase.google.com/
   - Click "Add project"
   - Name it (e.g., "MediaScope")
   - Disable Google Analytics (optional)
   - Click "Create project"

2. **Enable Firestore Database:**
   - In your new project, click "Firestore Database" in the left sidebar
   - Click "Create database"
   - Choose "Start in test mode" (for now - we'll secure it later)
   - Select your region (choose closest to you)
   - Click "Enable"

3. **Get Service Account Key:**
   - Click the gear icon ⚙️ next to "Project Overview"
   - Click "Project settings"
   - Go to "Service accounts" tab
   - Click "Generate new private key"
   - Click "Generate key" - a JSON file will download

4. **Add Key to MediaScope:**
   ```bash
   # Rename the downloaded file and move it to your MediaScope folder
   mv ~/Downloads/mediascope-*.json ./firebase-service-account.json
   ```

### Step 2: Run Migration (2-10 minutes depending on data size)

Make sure your PostgreSQL database is running, then:

```bash
# Activate your virtual environment
source venv/bin/activate

# Run the migration script
python migrate_to_firebase.py
```

The script will:
- ✓ Connect to your local PostgreSQL database
- ✓ Connect to Firebase Firestore
- ✓ Transfer all articles, entities, and metadata
- ✓ Show progress updates
- ✓ Verify the migration succeeded

### Step 3: Start Using Firebase

After successful migration:

```bash
# Start the backend (it will use Firebase automatically)
python mediascope_api.py

# In another terminal, start the frontend
cd mediascope-frontend
npm start
```

**That's it!** Your app now uses the shared Firebase cloud database.

## What Happens Next?

- ✅ **Your local data is now in the cloud**
- ✅ **Anyone running MediaScope connects to the same database**
- ✅ **No more local PostgreSQL setup needed**
- ✅ **Real-time data sync across all users**

## Troubleshooting

### "Firebase service account key not found"
- Make sure you downloaded the JSON key from Firebase Console
- Rename it to `firebase-service-account.json`
- Place it in the same folder as `mediascope_api.py`

### "PostgreSQL connection error"
- Make sure your local PostgreSQL is running
- Check your `.env` file has correct database credentials

### "Migration failed"
- Check the error message in the console
- The script will tell you exactly what went wrong
- You can run it multiple times - it won't duplicate data

## Security Note

The Firebase test mode rules allow anyone to read/write. For production:

1. Go to Firebase Console → Firestore Database → Rules
2. Update the rules to require authentication
3. See `FIREBASE_SETUP.md` for details

## Need Help?

- Check `FIREBASE_SETUP.md` for detailed Firebase setup
- Check `README.md` for general MediaScope info
- The migration script shows detailed progress and errors
