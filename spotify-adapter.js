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
  Property
} = require('gateway-addon');


class SpotifyProperty extends Property {
  constructor(device, name, setValueCb, propDescr) {
    super(device, name, propDescr);
    this.setValueHandler = setValueCb;
  }

  updateValue(value) {
    this.setCachedValue(value);
    this.device.notifyPropertyChanged(this);
  }

  setValue(value) {
    return new Promise((resolve, reject) => {
      this.setValueCb(value)
        .then((updatedValue) => {
          this.setCachedValue(updatedValue);
          resolve(updatedValue);
          this.device.notifyPropertyChanged(this);
        })
        .catch((err) => reject(err));
    });
  }
}

class SpotifyDevice extends Device {
  constructor(adapter, manifest) {
    super(adapter, manifest.display_name);

    this['@context'] = 'https://iot.mozilla.org/schemas/';
    this.title = manifest.display_name;
    this['@type'] = manifest['@type'] || [ 'OnOffSwitch' ];
    this.description = manifest.description;
    this.config = manifest.moziot.config;
    this.spotifyActions = {};
    this.spotifyApi = new SpotifyWebApi();

    if (!this.config.accessToken) {
      console.warn('No access token set');
    }
    this.spotifyApi.setAccessToken(this.config.accessToken);

    this.callOpts = {};
    if (this.config.deviceID) {
      this.callOpts.device_id = this.config.deviceID;
    }

    this.initStateProperty();
    this.initActions();
  }

  schedulePolling() {
    const interval = (this.config.interval || 60) * 1000;
    setTimeout(() => this.updateState(), interval);
  }

  updateState() {
    this.spotifyApi.getMyCurrentPlaybackState()
      .then((response) => {
        if (response.statusCode == 204) {
          this.state.updateValue(false);
        } else if (response.statusCode === 200) {
          if (this.config.deviceID) {
            // eslint-disable-next-line max-len
            this.state.updateValue(response.body.device.id === this.config.deviceID &&
                                   response.body.is_playing);
          } else {
            this.state.updateValue(response.body.is_playing);
          }
        }

        this.schedulePolling();
      });
  }

  initStateProperty() {
    this.state = new SpotifyProperty(this, 'state', (value) => {
      if (value) {
        return this.spotifyApi.play(this.callOpts)
          .then(() => value);
      }

      return this.spotifyApi.pause(this.callOpts)
        .then(() => value);
    }, {
      title: 'state',
      '@type': 'OnOffProperty',
      type: 'boolean',
    });

    this.properties.set('state', this.state);
  }

  initActions() {
    this.addSpotifyAction('previous', {
      title: 'previous',
      description: 'Skip to the previous track',
    }, () => this.spotifyApi.skipToPrevious(this.callOpts));

    this.addSpotifyAction('next', {
      title: 'next',
      description: 'Skip to the next track',
    }, () => this.spotifyApi.skipToNext(this.callOpts));

    this.links = [
      {
        rel: 'alternate',
        mediaType: 'text/html',
        href: 'https://open.spotify.com',
      },
    ];

    this.addSpotifyAction('pause', {
      title: 'pause',
      description: 'Pause playback',
    }, () => this.spotifyApi.pause(this.callOpts));

    this.addSpotifyAction('play', {
      title: 'play',
      description: 'Start playback',
    }, () => this.spotifyApi.play(this.callOpts));
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
