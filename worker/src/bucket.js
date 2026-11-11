/**
 * Branding images (logos, icon, login background...). In production this is an R2 bucket bound as
 * `BRANDING`; this in-memory stand-in has the same three methods and is used for `wrangler dev`
 * without a bucket and in tests.
 */
export class MemoryBucket {
    #objects = new Map()

    async put(key, value, options = {}) {
        const bytes = new Uint8Array(await new Response(value).arrayBuffer())
        this.#objects.set(key, { bytes, httpMetadata: options.httpMetadata || {} })
    }

    async get(key) {
        const entry = this.#objects.get(key)
        if (!entry) return null
        return {
            body: new Blob([entry.bytes]).stream(),
            httpMetadata: entry.httpMetadata,
            size: entry.bytes.length,
        }
    }

    async delete(key) {
        this.#objects.delete(key)
    }

    has(key) {
        return this.#objects.has(key)
    }
}

let fallback
export const bucketOf = env => env.BRANDING || (fallback ??= new MemoryBucket())
