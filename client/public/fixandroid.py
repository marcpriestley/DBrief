#!/usr/bin/env python3
"""
fixandroid.py — replaces ~/dbrief/dist/public/ with the current Replit build.
Run this, then: npx cap sync android && cd android && ./gradlew clean installDebug
"""
import os, sys, urllib.request, tarfile, shutil, tempfile

base = os.path.expanduser('~/dbrief')
if not os.path.isdir(base):
    print(f"ERROR: {base} not found"); sys.exit(1)

REPLIT_DEV = "https://94e0858f-6af8-4cfd-b7eb-fe347fc2d89a-00-laqlds9m6kl3.spock.replit.dev"
TGZ_URL = f"{REPLIT_DEV}/dist-android.tar.gz"

print("Downloading current build from Replit...")
tmp = tempfile.mktemp(suffix='.tar.gz')
try:
    urllib.request.urlretrieve(TGZ_URL, tmp)
    print(f"  Downloaded to {tmp} ({os.path.getsize(tmp)//1024}KB)")
except Exception as e:
    print(f"ERROR downloading: {e}"); sys.exit(1)

dest = os.path.join(base, 'dist', 'public')
print(f"Replacing {dest} ...")
if os.path.exists(dest):
    shutil.rmtree(dest)
os.makedirs(dest, exist_ok=True)

with tarfile.open(tmp, 'r:gz') as tar:
    tar.extractall(dest)
os.unlink(tmp)
print(f"  Extracted {len(os.listdir(dest))} items to {dest}")

print("\nNow run:")
print(f"  cd {base}")
print("  npx cap sync android")
print('  export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"')
print("  cd android && ./gradlew clean installDebug")
