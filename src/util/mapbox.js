// @flow

import config from './config';

import browser from './browser';
import window from './window';
import { version } from '../../package.json';
import { uuid, validateUuid, storageAvailable } from './util';

const help = 'See https://www.mapbox.com/api-documentation/#access-tokens';

type UrlObject = {|
    protocol: string,
    authority: string,
    path: string,
    params: Array<string>
|};

function makeAPIURL(urlObject: UrlObject, accessToken: string | null | void): string {
    const apiUrlObject = parseUrl(config.API_URL);
    urlObject.protocol = apiUrlObject.protocol;
    urlObject.authority = apiUrlObject.authority;

    if (apiUrlObject.path !== '/') {
        urlObject.path = `${apiUrlObject.path}${urlObject.path}`;
    }

    if (!config.REQUIRE_ACCESS_TOKEN) return formatUrl(urlObject);

    accessToken = accessToken || config.ACCESS_TOKEN;
    if (!accessToken)
        throw new Error(`An API access token is required to use Mapbox GL. ${help}`);
    if (accessToken[0] === 's')
        throw new Error(`Use a public access token (pk.*) with Mapbox GL, not a secret access token (sk.*). ${help}`);

    urlObject.params.push(`access_token=${accessToken}`);
    return formatUrl(urlObject);
}

function isMapboxURL(url: string) {
    return url.indexOf('mapbox:') === 0;
}

export { isMapboxURL };

export const normalizeStyleURL = function(url: string, accessToken?: string): string {
    if (!isMapboxURL(url)) return url;
    const urlObject = parseUrl(url);
    urlObject.path = `/styles/v1${urlObject.path}`;
    return makeAPIURL(urlObject, accessToken);
};

export const normalizeGlyphsURL = function(url: string, accessToken?: string): string {
    if (!isMapboxURL(url)) return url;
    const urlObject = parseUrl(url);
    urlObject.path = `/fonts/v1${urlObject.path}`;
    return makeAPIURL(urlObject, accessToken);
};

export const normalizeSourceURL = function(url: string, accessToken?: string): string {
    if (!isMapboxURL(url)) return url;
    const urlObject = parseUrl(url);
    urlObject.path = `/v4/${urlObject.authority}.json`;
    // TileJSON requests need a secure flag appended to their URLs so
    // that the server knows to send SSL-ified resource references.
    urlObject.params.push('secure');
    return makeAPIURL(urlObject, accessToken);
};

export const normalizeSpriteURL = function(url: string, format: string, extension: string, accessToken?: string): string {
    const urlObject = parseUrl(url);
    if (!isMapboxURL(url)) {
        urlObject.path += `${format}${extension}`;
        return formatUrl(urlObject);
    }
    urlObject.path = `/styles/v1${urlObject.path}/sprite${format}${extension}`;
    return makeAPIURL(urlObject, accessToken);
};

const imageExtensionRe = /(\.(png|jpg)\d*)(?=$)/;

export const normalizeTileURL = function(tileURL: string, sourceURL?: ?string, tileSize?: ?number): string {
    if (!sourceURL || !isMapboxURL(sourceURL)) return tileURL;

    const urlObject = parseUrl(tileURL);

    // The v4 mapbox tile API supports 512x512 image tiles only when @2x
    // is appended to the tile URL. If `tileSize: 512` is specified for
    // a Mapbox raster source force the @2x suffix even if a non hidpi device.
    const suffix = browser.devicePixelRatio >= 2 || tileSize === 512 ? '@2x' : '';
    const extension = browser.supportsWebp ? '.webp' : '$1';
    urlObject.path = urlObject.path.replace(imageExtensionRe, `${suffix}${extension}`);

    replaceTempAccessToken(urlObject.params);
    return formatUrl(urlObject);
};

function replaceTempAccessToken(params: Array<string>) {
    for (let i = 0; i < params.length; i++) {
        if (params[i].indexOf('access_token=tk.') === 0) {
            params[i] = `access_token=${config.ACCESS_TOKEN || ''}`;
        }
    }
}

const urlRe = /^(\w+):\/\/([^/?]*)(\/[^?]+)?\??(.+)?/;

function parseUrl(url: string): UrlObject {
    const parts = url.match(urlRe);
    if (!parts) {
        throw new Error('Unable to parse URL object');
    }
    return {
        protocol: parts[1],
        authority: parts[2],
        path: parts[3] || '/',
        params: parts[4] ? parts[4].split('&') : []
    };
}

function formatUrl(obj: UrlObject): string {
    const params = obj.params.length ? `?${obj.params.join('&')}` : '';
    return `${obj.protocol}://${obj.authority}${obj.path}${params}`;
}

export const postTurnstileEvent = function() {
    if (!config.ACCESS_TOKEN) return;
    const localStorageAvailable = storageAvailable('localSotorage');

    let anonId = null;
    let lastUpdateTime = null;
    //Retrieve cached data
    if (localStorageAvailable) {
        const data = window.localStorage.getItem('mapbox.userTurnstileData');
        if (data) {
            const json = JSON.parse(data);
            anonId = json.anonId;
            lastUpdateTime = json.lastSuccess;
        }
    }

    if (!validateUuid(anonId)) {
        anonId = uuid();
    }

    // Record turnstile event once per calendar day.
    if (lastUpdateTime) {
        const lastUpdate = new Date(Number(lastUpdateTime));
        const now = new Date();
        const daysElapsed = (+now - lastUpdate) / (24 * 60 * 60 * 1000);
        // In case its the same day of the month, check the actual time elapsed.
        if (lastUpdate.getDate() === now.getDate() && daysElapsed >= 0 && daysElapsed < 1) {
            return;
        }
    }

    const evenstUrlObject: UrlObject = parseUrl(config.EVENTS_URL);
    evenstUrlObject.params.push(`access_token=${config.ACCESS_TOKEN || ''}`);
    const eventsUrl = formatUrl(evenstUrlObject);

    const xhr: XMLHttpRequest = new window.XMLHttpRequest();
    xhr.open('POST', eventsUrl, true);
    xhr.setRequestHeader('Content-Type', 'text/plain'); //Skip the pre-flight OPTIONS request

    //On a successful ping, update the last update time stamp
    xhr.onreadystatechange = function() {
        if (localStorageAvailable &&
            this.readyState === 4 /* DONE */ && this.status === 200 || this.status === 204) {
            window.localStorage.setItem('mapbox.userTurnstileData', JSON.stringify({
                lastSuccess: Date.now(),
                anonId: anonId
            }));
        }
    };

    xhr.send(JSON.stringify([{
        event: 'appUserTurnstile',
        created: (new Date()).toISOString(),
        sdkIdentifier: 'mapbox-gl-js',
        sdkVersion: `${version}`,
        'enabled.telemetry': false,
        userId: anonId
    }]));
};
