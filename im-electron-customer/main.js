const { app, BrowserWindow, shell, Notification, powerSaveBlocker, ipcMain, Tray, Menu, nativeImage } = require('electron');
const path = require('path');

// Prevent display from sleeping
const id = powerSaveBlocker.start('prevent-display-sleep');

if (process.platform === 'win32') {
    app.setAppUserModelId('com.gqtrade.customer');
}

let mainWindow = null;
let tray = null;
let isQuitting = false;

function createTray() {
    const iconPath = path.join(__dirname, 'icon.png');
    let trayIcon = nativeImage.createFromPath(iconPath);
    
    if (process.platform === 'win32') {
        trayIcon = trayIcon.resize({ width: 16, height: 16 });
    }
    
    tray = new Tray(trayIcon);
    
    const contextMenu = Menu.buildFromTemplate([
        {
            label: '显示窗口',
            click: () => {
                if (mainWindow) {
                    mainWindow.show();
                    mainWindow.focus();
                }
            }
        },
        {
            label: '隐藏窗口',
            click: () => {
                if (mainWindow) {
                    mainWindow.hide();
                }
            }
        },
        { type: 'separator' },
        {
            label: '退出',
            click: () => {
                isQuitting = true;
                app.quit();
            }
        }
    ]);
    
    tray.setToolTip('GQ Trade');
    tray.setContextMenu(contextMenu);
    
    tray.on('click', () => {
        if (mainWindow) {
            if (mainWindow.isVisible()) {
                mainWindow.focus();
            } else {
                mainWindow.show();
                mainWindow.focus();
            }
        }
    });
    
    tray.on('double-click', () => {
        if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
        }
    });
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 420,
        height: 700,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            backgroundThrottling: false,
            preload: path.join(__dirname, 'preload.js')
        },
        autoHideMenuBar: true,
        icon: path.join(__dirname, 'icon.png'),
    });

    // 加载客户端页面 - 用户需要更新此URL
    mainWindow.loadURL('https://gqtrade.app/customer.html?force_desktop=1');

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('https://gqtrade.app')) {
            return { action: 'allow' };
        }
        shell.openExternal(url);
        return { action: 'deny' };
    });

    mainWindow.webContents.session.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
        if (permission === 'notifications' || permission === 'media') {
            return true;
        }
        return false;
    });

    mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
        if (permission === 'notifications' || permission === 'media') {
            return callback(true);
        }
        return callback(false);
    });

    // 最小化到托盘
    mainWindow.on('close', (event) => {
        if (!isQuitting) {
            event.preventDefault();
            mainWindow.hide();
            
            if (tray && !app.isHidden) {
                tray.displayBalloon({
                    iconType: 'info',
                    title: 'GQ Trade',
                    content: '程序已最小化到系统托盘，继续在后台运行接收消息。'
                });
                app.isHidden = true;
            }
            return false;
        }
    });

    ipcMain.on('update-badge', (event, count) => {
        if (process.platform === 'win32') {
            if (count > 0) {
                mainWindow.flashFrame(true);
                if (tray) {
                    tray.setToolTip(`GQ Trade (${count} 条新消息)`);
                }
            } else {
                mainWindow.flashFrame(false);
                if (tray) {
                    tray.setToolTip('GQ Trade');
                }
            }
        } else {
            app.setBadgeCount(count);
        }
    });

    ipcMain.on('focus-window', () => {
        if (mainWindow) {
            mainWindow.show();
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
            mainWindow.flashFrame(false);
        }
    });

    ipcMain.on('show-notification', (event, { title, body }) => {
        const n = new Notification({ 
            title, 
            body, 
            icon: path.join(__dirname, 'icon.png'),
            silent: false
        });
        n.on('click', () => {
            if (mainWindow) {
                mainWindow.show();
                if (mainWindow.isMinimized()) mainWindow.restore();
                mainWindow.focus();
                mainWindow.flashFrame(false);
            }
        });
        n.show();
    });
}

// 单实例锁定
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', (event, commandLine, workingDirectory) => {
        if (mainWindow) {
            mainWindow.show();
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });

    app.whenReady().then(() => {
        createWindow();
        createTray();

        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) {
                createWindow();
            } else if (mainWindow) {
                mainWindow.show();
            }
        });
    });
}

app.on('window-all-closed', () => {
    // 不退出，保持托盘运行
});

app.on('before-quit', () => {
    isQuitting = true;
});
