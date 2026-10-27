# App icon

`icon.html` is the source: the page's clock as a ring (midnight at the top, noon at the bottom,
green through yellow and orange to red), a white "now" dot, a sun in the middle. Render it to the
1024 px icon with headless Chrome, then flatten (the App Store refuses transparency):

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --hide-scrollbars \
  --force-device-scale-factor=1 --window-size=1024,1024 --screenshot="$PWD/icon.png" "file://$PWD/icon.html"
python3 -c "from PIL import Image; Image.open('icon.png').convert('RGB').save('../App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png')"
```
