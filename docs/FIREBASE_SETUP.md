# Firebase Setup Instructions

## Setting up Firebase Firestore for MediaScope

MediaScope now uses Firebase Firestore as a cloud database so that everyone shares the same data.

### Step 1: Create a Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click "Add project" or select an existing project
3. Follow the setup wizard to create your project

### Step 2: Enable Firestore Database

1. In your Firebase project, click on "Firestore Database" in the left sidebar
2. Click "Create database"
3. Choose "Start in production mode" or "Test mode" (for development)
4. Select your preferred Cloud Firestore location
5. Click "Enable"

### Step 3: Generate Service Account Key

1. In Firebase Console, click the gear icon next to "Project Overview"
2. Click "Project settings"
3. Go to the "Service accounts" tab
4. Click "Generate new private key"
5. Click "Generate key" to download the JSON file

### Step 4: Configure MediaScope

1. Rename the downloaded JSON file to `firebase-service-account.json`
2. Place it in the MediaScope root directory (same folder as `mediascope_api.py`)
3. Make sure `.gitignore` includes `firebase-service-account.json` to keep your credentials safe

### Step 5: Update Environment Variables

The `.env` file should already have:
```
FIREBASE_SERVICE_ACCOUNT_PATH=firebase-service-account.json
```

If not, add this line.

### Step 6: Security Rules (Optional but Recommended)

In Firebase Console, go to Firestore Database > Rules and set appropriate security rules:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Allow authenticated users to read/write
    match /{document=**} {
      allow read, write: if true; // Change this for production!
    }
  }
}
```

For production, you should restrict access based on your authentication requirements.

### Step 7: Run MediaScope

Start the backend as usual:
```bash
python mediascope_api.py
```

The system will now use Firebase Firestore as the shared cloud database!

## Benefits

- **Shared Database**: Everyone running MediaScope connects to the same cloud database
- **No Local Setup**: No need to install PostgreSQL or Elasticsearch locally
- **Automatic Scaling**: Firebase handles scaling automatically
- **Real-time Sync**: Changes are instantly available to all users

## Troubleshooting

If you get authentication errors:
1. Verify the `firebase-service-account.json` file exists
2. Check that the file path in `.env` is correct
3. Ensure your Firebase project has Firestore enabled
4. Verify the service account has proper permissions in Firebase Console

If you encounter permission errors:
1. Go to Firebase Console > Firestore Database > Rules
2. Temporarily set rules to allow all access for testing
3. Configure proper security rules for production
