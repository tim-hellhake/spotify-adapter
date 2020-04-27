# Spotify Adapter

[![Build Status](https://travis-ci.org/tim-hellhake/spotify-adapter.svg?branch=master)](https://travis-ci.org/tim-hellhake/spotify-adapter)
[![dependencies](https://david-dm.org/tim-hellhake/spotify-adapter.svg)](https://david-dm.org/tim-hellhake/spotify-adapter)
[![devDependencies](https://david-dm.org/tim-hellhake/spotify-adapter/dev-status.svg)](https://david-dm.org/tim-hellhake/spotify-adapter?type=dev)
[![optionalDependencies](https://david-dm.org/tim-hellhake/spotify-adapter/optional-status.svg)](https://david-dm.org/tim-hellhake/spotify-adapter?type=optional)
[![license](https://img.shields.io/badge/license-MPL--2.0-blue.svg)](LICENSE)

Control your spotify player.

## Configuration

### Short-time Access Token

In order to test the spotify adapter it should be enough to generate a short-lived access token using the Developer Console of Spotify. The token will typically expire after one hour and needs to be re-created by repeating the steps below.

 1. Go to https://developer.spotify.com/console/post-next
 2. Create an access token with the permission `user-modify-playback-state` and `user-read-playback-state`
 3. Add access token to the settings. Make sure to leave Client-ID and Client-Secret empty.

### Authorize using a Spotify Client (recommended)

Although a bit more complex this option is recommened as it will keep spotify-adapter authorized over a long time:

 1. Log into [Spoitfy Developer Dashboard](https://developer.spotify.com/dashboard/applications)
 2. Create a new application by clicking "Create A Client ID"
 3. Fill in required information and create a new application

![Enter a name, description and select "I don't know"](/images/create-dialog-1.jpg)
![Accept Spotify conditions](/images/create-dialog-2.jpg)

 4. On the application/client page press "Edit Settings" and add a new Redirect URI to "https://ppacher.github.io/spotify-auth-callback"

 5. Copy Client-ID and Client-Secret and add it to the configuration of Spotify-Adapter:

![Copy ClientID and Client-Secret](/images/create-dialog-3.jpg)

 6. Save Spotify-Adapter settings and open the settings menu again. Once the adapter has been reloaded, an authentication URL should be generated and visible in "Open URL to authenticate".

 7. Copy the URL and open it in your browser. Follow the authentication procedure from Spotify by clicking on "Authorize".

 8. You will be redirected to the "Redirect-URI" configured above, copy the code displayed on the page and add it as the access token to the Spotify-Adapter settings.

 9. You're done :)
