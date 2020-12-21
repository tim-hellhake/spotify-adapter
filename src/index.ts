/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.*
 */

'use strict';

import {AddonManagerProxy} from 'gateway-addon';
import {Manifest, SpotifyAdapter} from './spotify-adapter';

export = function(addonManager: AddonManagerProxy, manifest: Manifest): void {
  new SpotifyAdapter(addonManager, manifest);
}
