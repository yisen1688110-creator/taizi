const { app, BrowserWindow, shell, Notification, powerSaveBlocker, ipcMain } = require('electron');
const path = require('path');

// Prevent display from sleeping to ensure 'always online' status
const id = powerSaveBlocker.start('prevent-display-sleep');

if (process.platform === 'win32') {
    app.setAppUserModelId('com.gqtrade.agent');
}

function createWindow() {
    const win = new BrowserWindow({
        width: 1280,
        height: 900,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            backgroundThrottling: false, // Critical: prevent sleep when minimized/hidden
            preload: path.join(__dirname, 'preload.js')
        },
        autoHideMenuBar: true,
    });

    // Load the agent interface
    // NOTE: User should update this URL if deploying to a different domain
    win.loadURL('https://gqtrade.app/agent.html?force_desktop=1');

    // Handle external links (open in default browser)
    win.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('https://gqtrade.app')) {
            return { action: 'allow' };
        }
        shell.openExternal(url);
        return { action: 'deny' };
    });

    // Permission handler for notifications
    win.webContents.session.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
        if (permission === 'notifications' || permission === 'media') {
            return true;
        }
        return false;
    });

    win.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
        if (permission === 'notifications' || permission === 'media') {
            return callback(true);
        }
        return callback(false);
    });

    ipcMain.on('update-badge', (event, count) => {
        if (process.platform === 'win32') {
            if (count > 0) {
                win.flashFrame(true)
            } else {
                win.flashFrame(false)
            }
        } else {
            app.setBadgeCount(count)
        }
    })

    ipcMain.on('focus-window', () => {
        if (win) {
            if (win.isMinimized()) win.restore()
            win.focus()
            win.flashFrame(false)
        }
    })

    ipcMain.on('show-notification', (event, { title, body }) => {
        const n = new Notification({ title, body, icon: path.join(__dirname, 'icon.png') })
        n.on('click', () => {
            if (win) {
                if (win.isMinimized()) win.restore()
                win.focus()
                win.flashFrame(false)
            }
        })
        n.show()
    })
}

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
