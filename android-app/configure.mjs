// Writes capacitor.config.json so the Android app opens your hosted Clinic Connect.
// The address comes from the APP_URL environment variable (set by the GitHub workflow).
import { writeFileSync } from 'node:fs';

const url = (process.env.APP_URL || '').trim().replace(/\/+$/, '');
if (!/^https:\/\/[^\s/]+/.test(url)) {
  console.error(`APP_URL must be the https:// address of your hosted Clinic Connect. Got: "${url}"`);
  process.exit(1);
}

const config = {
  appId: 'com.clinicconnect.app',
  appName: 'Clinic Connect',
  webDir: 'www',
  server: {
    url,
    cleartext: false,
    errorPath: 'offline.html'
  },
  android: {
    backgroundColor: '#F3F6F5'
  }
};
writeFileSync('capacitor.config.json', JSON.stringify(config, null, 2) + '\n');
console.log(`Android app will open ${url}`);
