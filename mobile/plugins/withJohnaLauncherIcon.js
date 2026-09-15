const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs/promises');
const path = require('path');

const launcherVector = `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
  <path android:fillColor="#123B2D" android:pathData="M0,0h108v108h-108z" />
  <path android:fillColor="#D9B45B" android:pathData="M22,68h64v6h-64z" />
  <path android:fillColor="#D9B45B" android:pathData="M30,64c2,-20 13,-31 24,-31s22,11 24,31h-6c-2,-15 -9,-24 -18,-24s-16,9 -18,24z" />
  <path android:fillColor="#D9B45B" android:pathData="M50,25a4,4 0,1 0,8 0a4,4 0,1 0,-8 0" />
  <path android:fillColor="#FFFFFF" android:pathData="M28,80h52v5h-52z" />
  <path android:fillColor="#FFFFFF" android:pathData="M36,88h36v4h-36z" />
</vector>`;

module.exports = (config) => withDangerousMod(config, ['android', async (androidConfig) => {
  const res = path.join(androidConfig.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res');
  const dirs = [
    path.join(res, 'mipmap-anydpi'),
    path.join(res, 'mipmap-anydpi-v26'),
  ];
  for (const dir of dirs) await fs.mkdir(dir, { recursive: true });

  await fs.writeFile(path.join(res, 'mipmap-anydpi', 'ic_launcher.xml'), launcherVector, 'utf8');
  await fs.writeFile(path.join(res, 'mipmap-anydpi', 'ic_launcher_round.xml'), launcherVector, 'utf8');
  await fs.writeFile(path.join(res, 'mipmap-anydpi-v26', 'ic_launcher.xml'), launcherVector, 'utf8');
  await fs.writeFile(path.join(res, 'mipmap-anydpi-v26', 'ic_launcher_round.xml'), launcherVector, 'utf8');
  return androidConfig;
}]);
