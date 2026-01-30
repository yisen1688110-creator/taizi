const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
    updateBadge: (count) => ipcRenderer.send('update-badge', count),
    focusWindow: () => ipcRenderer.send('focus-window'),
    showNotification: (title, body) => ipcRenderer.send('show-notification', { title, body })
})
