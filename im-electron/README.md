# GQ Agent Desktop App

This is a wrapper for the GQ Agent web interface.

## Build Instructions (Windows)

1.  **Install Node.js**: Ensure Node.js is installed on your Windows machine.
2.  **Open Terminal**: Open PowerShell or Command Prompt in this folder.
3.  **Run Setup**:
    Double-click `setup.bat`.
    This script will automatically:
    -   Configure fast download mirrors.
    -   Install dependencies.
    -   Build the application.

4.  **Locate Installer**:
    When the script finishes, the `.exe` file will be in the `dist` folder.

## Features
-   **Always On**: Prevents background throttling and display sleep to ensure the agent shows as "Online".
## Troubleshooting

### PowerShell "UnauthorizedAccess" Error
If you see an error like "cannot be loaded because running scripts is disabled on this system":
1.  Open PowerShell as Administrator.
2.  Run: `Set-ExecutionPolicy RemoteSigned -Scope CurrentUser`
3.  Type `Y` to confirm.
4.  Try `npm install` again.

### Network Errors (ECONNRESET)
The download failed due to network issues. I have added a `.npmrc` file to automatically use a faster mirror server (npmmirror).

**Solution:**
1.  **Delete** the `node_modules` folder inside `im-electron`.
2.  Run `npm install` again.

