/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.*
 */

'use strict';

import {AddonManagerProxy} from 'gateway-addon';
import {SpotifyApiHandler} from './spotify-api-handler';
import {Manifest, SpotifyAdapter} from './spotify-adapter';
import {TokenProvider} from './token-provider';

export = async function(addonManager: AddonManagerProxy, manifest: Manifest)
: Promise<void> {
  const tokenProvider = new TokenProvider();
  try {
    await tokenProvider.init();
  } catch (e) {
    console.warn(`Could not initialize token provider: ${e}`);
  }
  new SpotifyAdapter(addonManager, manifest, tokenProvider);
  new SpotifyApiHandler(addonManager, tokenProvider);
}
