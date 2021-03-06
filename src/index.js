import qs from 'qs'

export default class {
	constructor( config ) {
		this.url = config.rest_url ? config.rest_url : ( config.url + 'wp-json' )
		this.url = this.url.replace( /\/$/, '' )
		this.credentials = Object.assign( {}, config.credentials )
		this.scope = config.scope || null

		if ( ! this.credentials.type ) {
			this.credentials.type = this.credentials.client.secret ? 'code' : 'token'
		}
		this.config = config
	}

	getClientCredentials() {
		if ( ! this.config.brokerCredentials ) {
			throw new Error( 'Config does not include a brokerCredentials value.' )
		}

		this.credentials.client = this.config.brokerCredentials.client
		return this.post( `${this.config.brokerURL}broker/connect`, {
			server_url: this.config.url,
		} ).then( data => {

			if ( data.status && data.status === 'error' ) {
				throw { message: `Broker error: ${data.message}`, code: data.type }
			}
			this.credentials.client = {
				id: data.client_token,
				secret: data.client_secret,
			}

			return data
		} )
	}

	getRedirectURL( state ) {
		if ( ! this.config.callbackURL ) {
			throw new Error( 'Config does not include a callbackURL value.' )
		}

		const args = {
			response_type: this.credentials.type,
			client_id: this.credentials.client.id,
			redirect_uri: this.config.callbackURL,
		}
		if ( this.scope ) {
			args.scope = this.scope
		}
		if ( state ) {
			args.state = state
		}
		return `${this.url}/oauth2/authorize?${qs.stringify(args)}`
	}

	getAccessToken( code ) {
		const args = {
			grant_type: 'authorization_code',
			client_id: this.credentials.client.id,
			redirect_uri: this.config.callbackURL,
			code,
		}
		const opts = {
			method: 'POST',
			mode: 'cors',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: qs.stringify( args ),
		}

		if ( 'secret' in this.credentials.client ) {
			const encodedAuth = btoa( this.credentials.client.id + ':' + this.credentials.client.secret )
			opts.headers.Authorization = `Basic ${encodedAuth}`
			delete args.client_id
		}

		return fetch( `${this.url}/oauth2/access_token`, opts ).then( resp => {
			return resp.json().then( data => {
				if ( ! resp.ok ) {
					throw new Error( data.message )
				}
				this.credentials.token = {
					public: data.access_token,
				}

				return this.credentials.token
			})
		})
	}

	getAuthorizationHeader() {
		if ( ! this.credentials.token ) {
			return {}
		}

		return { Authorization: `Bearer ${this.credentials.token.public}` }
	}

	authorize( next ) {

		var args = {}
		var savedCredentials = window.localStorage.getItem( 'requestTokenCredentials' )

		// Parse implicit token passed in fragment
		if ( savedCredentials ) {
			if ( window.location.href.indexOf( '?' ) ) {
				args = qs.parse( window.location.href.split('?')[1] )
			}
			if ( window.location.href.indexOf( '#' ) && this.credentials.type === 'token' ) {
				args = qs.parse( window.location.hash.substring( 1 ) )

				// Remove the hash if we can.
				if ( window.history.pushState ) {
					window.history.pushState( null, null, window.location.href.split('#')[0] )
				} else {
					window.location.hash = ''
				}
			}
		}

		if ( ! this.credentials.client ) {
			return this.getClientCredentials().then( this.authorize.bind( this ) )
		}

		if ( this.credentials.token ) {
			if ( this.credentials.token.public ) {
				return Promise.resolve("Success")
			}

			// We have an invalid token stored
			return Promise.reject( new Error( 'invalid_stored_token' ) )
		}

		if ( savedCredentials ) {
			this.credentials = JSON.parse( savedCredentials )
			window.localStorage.removeItem( 'requestTokenCredentials' )
		}

		if ( args.access_token ) {
			this.credentials.token = {
				public: args.access_token
			}
			return Promise.resolve( this.credentials.token )
		}

		// No token yet, and no attempt, so redirect to authorization page.
		if ( ! savedCredentials ) {
			console.log( savedCredentials )
			window.localStorage.setItem( 'requestTokenCredentials', JSON.stringify( this.credentials ) )
			window.location = this.getRedirectURL()
			throw 'Redirect to authrization page...'
		}

		// Attempted, and we have a code.
		if ( args.code ) {
			return this.getAccessToken( args.code )
		}

		// Attempted, and we have an error.
		if ( args.error ) {
			return Promise.reject( new Error( args.error ) )
		}

		// Attempted, but no code or error, so user likely manually cancelled the process.
		// Delete the saved credentials, and try again.
		this.credentials = Object.assign( {}, this.config.credentials )
		if ( ! this.credentials.type ) {
			this.credentials.type = this.credentials.client.secret ? 'code' : 'token'
		}
		return this.authorize()
	}

	saveCredentials() {
		window.localStorage.setItem( 'tokenCredentials', JSON.stringify( this.credentials ) )
	}

	removeCredentials() {
		delete this.credentials.token
		window.localStorage.removeItem( 'tokenCredentials' )
	}

	hasCredentials() {
		return this.credentials
			&& this.credentials.client
			&& this.credentials.client.id
			&& this.credentials.token
			&& this.credentials.token.public
	}

	restoreCredentials() {
		var savedCredentials = window.localStorage.getItem( 'tokenCredentials' )
		if ( savedCredentials ) {
			this.credentials = JSON.parse( savedCredentials )
		}
		return this
	}

	get( url, data ) {
		return this.request( 'GET', url, data )
	}

	post( url, data ) {
		return this.request( 'POST', url, data )
	}

	del( url, data ) {
		return this.request( 'DELETE', url, data )
	}

	request( method, url, data = null ) {
		if ( url.indexOf( 'http' ) !== 0 ) {
			url = this.url + url
		}

		if ( method === 'GET' && data ) {
			url += `?${decodeURIComponent( qs.stringify(data) )}`
			data = null
		}

		var headers = {
			Accept: 'application/json'
		}

		if ( method !== 'GET' && method !== 'HEAD' && data ) {
			headers['Content-Type'] = 'application/x-www-form-urlencoded';
		}

		/**
		 * Only attach the oauth headers if we have a request token
		 */
		if ( this.credentials.token ) {
			headers = {...headers, ...this.getAuthorizationHeader()}
		}

		const opts = {
			method,
			headers,
			mode: 'cors',
			body: ['GET','HEAD'].indexOf( method ) > -1 ? null : qs.stringify( data )
		}

		return fetch( url, opts ).then( parseResponse )
	}

	fetch( url, options ) {
		// Make URL absolute
		const relUrl = url[0] === '/' ? url.substring( 1 ) : url
		const absUrl = new URL( relUrl, this.url + '/' )

		// Clone options
		const actualOptions = { headers: {}, ...options }

		/**
		 * Only attach the oauth headers if we have a request token
		 */
		if ( this.credentials.token ) {
			actualOptions.headers = {...actualOptions.headers, ...this.getAuthorizationHeader()}
		}

		return fetch( absUrl, actualOptions )
	}
}

export const parseResponse = resp => resp.json().then( data => {
	if ( resp.ok ) {
		// Expose response via a getter, which avoids copying.
		Object.defineProperty( data, 'getResponse', {
			get: () => () => resp,
		} );
		return data;
	}

	// Build an error
	const err = new Error( data.message )
	err.code = data.code
	err.data = data.data
	throw err
} )

/**
 * A manifest object representing a site.
 *
 * @typedef {object} Manifest
 * @property {string} url - Root URL for the REST API
 * @property {object} authentication - Map of authentication type to authentication details for available auth.
 * @property {string[]} namespaces - Available namespaces.
 * @property {object} index - Raw index data from the site.
 */

/**
 * Discover the REST API from a URL.
 *
 * Runs the auto-discovery mechanism, and finds the API index.
 *
 * @param {string} url URL to run discovery on.
 * @return {Promise.<Manifest>} Promise resolving to a Manifest object, or error if API cannot be found.
 */
export const discover = url => {
	const indexUrl = new URL( url )
	indexUrl.search = '?rest_route=/'

	return fetch( indexUrl )
		.then( resp => {
			if ( ! resp.ok ) {
				throw new Error( 'Non-200 from API' );
			}

			return resp.json().then( data => {
				return {
					url: data.routes['/']._links.self,
					authentication: data.authentication,
					namespaces: data.namespaces,
					index: data,
				}
			})
		})
		.catch( e => {
			throw new Error( 'Unable to find the REST API' )
		})
}
