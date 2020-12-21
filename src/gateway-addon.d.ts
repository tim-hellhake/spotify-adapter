/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

declare module 'gateway-addon' {
    class Event {
      constructor(_device: unknown, _name: string, _data?: unknown);
    }

    interface EventDescription {
        name: string;
        metadata: EventMetadata;
    }

    interface EventMetadata {
        description: string,
        type: string
    }

    class Property {
        protected name: string;

        public maximum: number;

        constructor(_device: Device, _name: string, _propertyDescr: unknown);

        public setCachedValue(_value: unknown): void;

        public setCachedValueAndNotify(_value: unknown): void;

        public setValue(_value: unknown): Promise<void>
    }

    class Device {
        protected id: string;

        protected '@context': string;

        protected '@type': string[];

        protected title: string;

        protected description: string;

        protected links: Link[];

        constructor(_adapter: Adapter, _id: string);

        public properties: Map<string, Property>;

        public notifyPropertyChanged(_property: Property): void;

        public addAction(_name: string, _metadata: unknown): void;

        public events: Map<string, EventDescription>;

        public eventNotify(_event: Event): void;
    }

    interface Link {
        rel: string,
        mediaType: string,
        href: string
    }

    class Adapter {
      constructor(
        _addonManager: AddonManager, _id: string, _packageName: string);

      public handleDeviceAdded(_device: Device): void;
    }

    class Database {
      constructor(_packageName: string, _path?: string);

      public open(): Promise<void>;

      public loadConfig(): Promise<Record<string, string>>;

      public saveConfig(
        _config: Record<string, string | boolean>): Promise<void>;
    }

    class AddonManager {
      addAdapter(_adapter: Adapter): void;
    }

    interface Manifest {
      name: string,
      display_name: string,
      moziot: {
        config: Record<string, string>
      }
    }
}
