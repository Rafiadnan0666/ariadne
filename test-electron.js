const { app } = require('electron');
app.whenReady().then(() => {
  console.log('App ready');
  process.exit(0);
});
app.on('window-all-closed', () => process.exit(0));