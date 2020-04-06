import React, { useMemo } from 'react'
import Head from 'next/head'
import { ApolloProvider } from '@apollo/react-hooks'
import { ApolloClient, InMemoryCache, HttpLink } from 'apollo-boost'
import fetch from 'isomorphic-unfetch'
import { isFunction } from 'lodash'

let apolloClient = null

const createDefaultCache = () => new InMemoryCache()

export default apolloConfig => {
  return (PageComponent, { ssr = true } = {}) => {
    const WithApollo = ({ apolloClient, apolloState, ...pageProps }) => {
      const client = useMemo(
        () => apolloClient || initApolloClient(apolloConfig, apolloState),
        []
      )
      return (
        <ApolloProvider client={client}>
          <PageComponent {...pageProps} />
        </ApolloProvider>
      )
    }

    // Set the correct displayName in development
    if (process.env.NODE_ENV !== 'production') {
      const displayName =
        PageComponent.displayName || PageComponent.name || 'Component'

      if (displayName === 'App') {
        console.warn('This withApollo HOC only works with PageComponents.')
      }

      WithApollo.displayName = `withApollo(${displayName})`
    }

    if (ssr || PageComponent.getServerSideProps) {
      WithApollo.getServerSideProps = async context => {
        const { AppTree } = context

        // Initialize ApolloClient, add it to the context object so
        // we can use it in `PageComponent.getInitialProp`.
        const apolloClient = (context.apolloClient = initApolloClient(
          apolloConfig,
          null,
          context
        ))

        // Run wrapped getServerSideProps methods
        let pageProps = {}
        if (PageComponent.getServerSideProps) {
          pageProps = await PageComponent.getServerSideProps(context)
        }

        // Only on the server:
        if (typeof window === 'undefined') {
          // When redirecting, the response is finished.
          // No point in continuing to render
          if (context.res && context.res.finished) {
            return pageProps
          }

          // Only if ssr is enabled
          if (ssr) {
            try {
              // Run all GraphQL queries
              const { getDataFromTree } = await import('@apollo/react-ssr')
              await getDataFromTree(
                <AppTree
                  pageProps={{
                    ...pageProps,
                    apolloClient
                  }}
                />
              )
            } catch (error) {
              // Prevent Apollo Client GraphQL errors from crashing SSR.
              // Handle them in components via the data.error prop:
              // https://www.apollographql.com/docs/react/api/react-apollo.html#graphql-query-data-error
              console.error('Error while running `getDataFromTree`', error)
            }

            // getDataFromTree does not call componentWillUnmount
            // head side effect therefore need to be cleared manually
            Head.rewind()
          }
        }

        // Extract query data from the Apollo store
        const apolloState = apolloClient.cache.extract()

        return {
          ...pageProps,
          apolloState
        }
      }
    }

    return WithApollo
  }
}

/**
 * Always creates a new apollo client on the server
 * Creates or reuses apollo client in the browser.
 * @param  {Object} initialState
 */
function initApolloClient(apolloConfig, initialState = {}, context) {
  if (isFunction(apolloConfig)) {
    apolloConfig = apolloConfig(context)
  }
  // Make sure to create a new client for every server-side request so that data
  // isn't shared between connections (which would be bad)
  if (typeof window === 'undefined') {
    return createApolloClient(apolloConfig, initialState)
  }

  // Reuse client on the client-side
  if (!apolloClient) {
    apolloClient = createApolloClient(apolloConfig, initialState)
  }

  return apolloClient
}

/**
 * Creates and configures the ApolloClient
 * @param  {Object} [initialState={}]
 */
function createApolloClient(apolloConfig, initialState = {}) {
  const createCache = apolloConfig.createCache || createDefaultCache

  const config = {
    ssrMode: typeof window === 'undefined', // Disables forceFetch on the server (so queries are only run once)
    cache: createCache().restore(initialState || {}),
    ...apolloConfig
  }

  delete config.createCache

  return new ApolloClient(config)
}
