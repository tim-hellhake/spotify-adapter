/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.*
 */

'use strict';

const SpotifyWebApi = require('spotify-web-api-node');

const {
  Adapter,
  Device,
} = require('gateway-addon');

class SpotifyDevice extends Device {
  constructor(adapter, manifest) {
    super(adapter, manifest.display_name);
    this['@context'] = 'https://iot.mozilla.org/schemas/';
    this.name = manifest.display_name;
    this.description = manifest.description;
    this.config = manifest.moziot.config;
    this.spotifyActions = {};
    const spotifyApi = new SpotifyWebApi();
    spotifyApi.setAccessToken(this.config.accessToken);

    if (!this.config.accessToken) {
      console.warn('No access token set');
    }

    this.addSpotifyAction('previous', {
      title: 'previous',
      description: 'Skip to the previous track',
    }, () => spotifyApi.skipToPrevious());

    this.addSpotifyAction('next', {
      title: 'next',
      description: 'Skip to the next track',
    }, () => spotifyApi.skipToNext());
  }

  addSpotifyAction(name, description, apiCall) {
    this.spotifyActions[name] = apiCall;
    this.addAction(name, description);
  }

  async performAction(action) {
    action.start();

    const spotifyAction = this.spotifyActions[action.name];

    if (spotifyAction) {
      console.log(`Execute ${action.name} action`);
      spotifyAction();
    } else {
      console.warn(`Unknown action ${action}`);
    }

    action.finish();
  }
}

class SpotifyAdapter extends Adapter {
  constructor(addonManager, manifest) {
    super(addonManager, SpotifyAdapter.name, manifest.name);
    addonManager.addAdapter(this);
    const device = new SpotifyDevice(this, manifest);
    this.handleDeviceAdded(device);
  }
}

module.exports = SpotifyAdapter;
