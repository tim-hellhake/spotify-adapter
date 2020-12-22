(function() {
  class ExampleExtension extends window.Extension {
    constructor() {
      super('spotify-adapter');
      this.addMenuEntry('Spotify');

      if (!window.Extension.prototype.hasOwnProperty('load')) {
        this.load();
      }
    }

    load() {
      this.views = {};

      return Promise.all(['authorize', 'error', 'status']
        .map((name) => this.loadView(name)));
    }

    loadView(view) {
      return fetch(`/extensions/${this.id}/views/${view}.html`)
        .then((res) => res.text())
        .then((text) => {
          this.views[view] = text;
        })
        .catch((e) => console.error('Failed to fetch content:', e));
    }

    show() {
      const urlParams = new URLSearchParams(window.location.search);
      const code = urlParams.get('code');
      const error = urlParams.get('error');

      if (code) {
        this.authorize(code)
          .then(() => this.reload())
          .catch((e) => {
            console.error('Could not exchange code with refresh token', e);
          });
      } else if (error) {
        this.showErrorPage(error);
      } else {
        this.getStatus()
          .then((status) => {
            const {
              refreshToken,
            } = status;

            if (refreshToken) {
              this.showStatusPage(status);
            } else {
              this.showAuthorizationPage();
            }
          })
          .catch((error) => console.error('Could not get status: ', error));
      }
    }

    reload() {
      document.location.href = location.href.replace(location.search, '');
    }

    showAuthorizationPage() {
      this.view.innerHTML = this.views.authorize;

      const redirectUri = window.location.href;
      const redirectInfo =
        document.getElementById('extension-spotify-adapter-redirect-info');
      const clientId =
          document.getElementById('extension-spotify-adapter-form-client-id');
      const clientSecret =
          // eslint-disable-next-line max-len
          document.getElementById('extension-spotify-adapter-form-client-secret');
      const authorize =
        document.getElementById('extension-spotify-adapter-authorize-button');

      redirectInfo.innerHTML = redirectUri;

      authorize.addEventListener('click', () => {
        this.createAuthorizeUrl(
          clientId.value,
          clientSecret.value,
          redirectUri
        )
          .then((body) => {
            window.location.href = body.authorizeUrl;
          }).catch((e) => {
            console.error('Could not redirect to spotify', e);
          });
      });
    }

    showErrorPage(error) {
      this.view.innerHTML = this.views.error;

      const errorCode =
      document.getElementById('extension-spotify-adapter-error-code');

      errorCode.innerHTML = error;
    }

    showStatusPage(status) {
      this.view.innerHTML = this.views.status;

      const clientIdSpan =
      document.getElementById('extension-spotify-adapter-client-id');

      const clientSecretSpan =
      document.getElementById('extension-spotify-adapter-client-secret');

      const accessTokenSpan =
      document.getElementById('extension-spotify-adapter-access-token');

      const refreshTokenSpan =
      document.getElementById('extension-spotify-adapter-refresh-token');

      const resetButton =
      document.getElementById('extension-spotify-adapter-reset-button');

      const {
        clientId,
        clientSecret,
        accessToken,
        refreshToken,
      } = status;

      clientIdSpan.innerHTML = clientId;
      clientSecretSpan.innerHTML = clientSecret;
      accessTokenSpan.innerHTML = accessToken;
      refreshTokenSpan.innerHTML = refreshToken;

      resetButton.addEventListener('click', () => {
        this.reset()
          .then(() => this.reload())
          .catch((e) => {
            console.error('Could not reset authorization', e);
          });
      });
    }

    createAuthorizeUrl(clientId, clientSecret, redirectUri) {
      return window.API.postJson(
        `/extensions/${this.id}/api/authorize-url`,
        {clientId, clientSecret, redirectUri}
      );
    }

    authorize(code) {
      return window.API.postJson(
        `/extensions/${this.id}/api/authorize`,
        {code}
      );
    }

    getStatus() {
      return window.API.getJson(
        `/extensions/${this.id}/api/status`,
        {}
      );
    }

    reset() {
      return window.API.postJson(
        `/extensions/${this.id}/api/reset`,
        {}
      );
    }
  }

  new ExampleExtension();
})();
