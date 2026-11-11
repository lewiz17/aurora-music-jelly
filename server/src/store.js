import fs from 'node:fs'
import crypto from 'node:crypto'
import { paths } from './config.js'

const DEFAULT_DATA = {
    version: 1,
    settings: {
        // Shown in the UI instead of the product name
        brandName: 'Aurora Music',
        // Default theme: gradient id from THEMES in themes.js
        defaultTheme: 'aurora',
        // Default language: es | en
        defaultLanguage: 'es',
        // Label of the "server" field on the login screen. The user types a code here.
        codeFieldLabel: 'Código de acceso',
        codeFieldPlaceholder: 'Escribe el código que te compartieron',
        // Hide the settings "About/Session" block
        hideAbout: true,
    },
    // { id, code, jellyfinUrl, label, createdAt, active }
    servers: [],
    // admin user credentials (hashed)
    admin: null,
    // uploaded branding assets: { logoLight, logoDark, icon, loginBg, sidebarLogo... }
    assets: {},
    imports: {},
}

class StoreImpl {
    constructor() {
        this.data = this.#load()
    }

    #load() {
        try {
            const raw = fs.readFileSync(paths.data, 'utf8')
            const parsed = JSON.parse(raw)
            return { ...structuredClone(DEFAULT_DATA), ...parsed, settings: { ...DEFAULT_DATA.settings, ...(parsed.settings || {}) } }
        } catch {
            return structuredClone(DEFAULT_DATA)
        }
    }

    save() {
        const tmp = `${paths.data}.tmp`
        fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2))
        fs.renameSync(tmp, paths.data)
    }

    // ---------- settings ----------
    get settings() {
        return this.data.settings
    }

    updateSettings(patch) {
        this.data.settings = { ...this.data.settings, ...patch }
        this.save()
        return this.data.settings
    }

    // ---------- servers ----------
    get servers() {
        return this.data.servers
    }

    findByCode(code) {
        if (!code) return null
        const normalized = normalizeCode(code)
        return this.data.servers.find(s => normalizeCode(s.code) === normalized && s.active !== false) || null
    }

    /** Like findByCode, but also counts deactivated servers (a code must stay unique). */
    codeInUse(code, exceptId) {
        const normalized = normalizeCode(code)
        if (!normalized) return false
        return this.data.servers.some(s => s.id !== exceptId && normalizeCode(s.code) === normalized)
    }

    findById(id) {
        return this.data.servers.find(s => s.id === id) || null
    }

    addServer({ jellyfinUrl, label, code }) {
        const server = {
            id: crypto.randomUUID(),
            code: normalizeCode(code || generateCode()),
            jellyfinUrl: String(jellyfinUrl || '').replace(/\/+$/, ''),
            label: label || 'Mi servidor',
            createdAt: new Date().toISOString(),
            active: true,
        }
        this.data.servers.push(server)
        this.save()
        return server
    }

    updateServer(id, patch) {
        const server = this.findById(id)
        if (!server) return null
        const clean = Object.fromEntries(Object.entries(patch || {}).filter(([, value]) => value !== undefined))
        Object.assign(server, clean)
        if (clean.code) server.code = normalizeCode(clean.code)
        if (clean.jellyfinUrl) server.jellyfinUrl = String(clean.jellyfinUrl).replace(/\/+$/, '')
        this.save()
        return server
    }

    removeServer(id) {
        this.data.servers = this.data.servers.filter(s => s.id !== id)
        this.save()
    }

    // ---------- assets ----------
    get assets() {
        return this.data.assets
    }

    setAsset(slot, filename) {
        this.data.assets[slot] = filename
        this.save()
        return filename
    }

    removeAsset(slot) {
        delete this.data.assets[slot]
        this.save()
    }

    // ---------- imports (YT Music playlist staging) ----------
    saveImport(id, value) {
        this.data.imports[id] = value
        this.save()
    }

    getImport(id) {
        const record = this.data.imports[id]
        // The key is the source of truth for the id (the panel builds URLs from record.id)
        return record ? { ...record, id } : record
    }

    listImports() {
        return Object.entries(this.data.imports).map(([id, v]) => ({ id, ...v }))
    }

    // ---------- admin ----------
    setAdmin(username, password) {
        const salt = crypto.randomBytes(16).toString('hex')
        this.data.admin = {
            username,
            salt,
            hash: crypto.scryptSync(password, salt, 64).toString('hex'),
        }
        this.save()
    }

    verifyAdmin(username, password) {
        const admin = this.data.admin
        if (!admin) return false
        if (username !== admin.username) return false
        const candidate = crypto.scryptSync(password, admin.salt, 64)
        return crypto.timingSafeEqual(candidate, Buffer.from(admin.hash, 'hex'))
    }

    get hasAdmin() {
        return Boolean(this.data.admin)
    }
}

export const Store = new StoreImpl()

export const normalizeCode = code =>
    String(code || '')
        .trim()
        .toUpperCase()
        .replace(/\s+/g, '-')

// Short, unambiguous code (no 0/O, 1/I/L)
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const generateCode = (length = 6) => {
    let out = ''
    const bytes = crypto.randomBytes(length)
    for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length]
    return out
}
