const { createServer } = require('https')
const { parse } = require('url')
const next = require('next')
const fs = require('fs')
const path = require('path')

const dev = process.env.NODE_ENV !== 'production'
const hostname = '0.0.0.0' // Listen on all interfaces
const port = 3000

const app = next({ dev, hostname, port })
const handle = app.getRequestHandler()

// Try to load certificates, fall back to HTTP if not found
const certPath = path.join(__dirname, 'certificates', 'server-cert.pem')
const keyPath = path.join(__dirname, 'certificates', 'server-key.pem')

let server

if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
  const httpsOptions = {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath),
  }

  app.prepare().then(() => {
    server = createServer(httpsOptions, async (req, res) => {
      try {
        const parsedUrl = parse(req.url, true)
        await handle(req, res, parsedUrl)
      } catch (err) {
        console.error('Error occurred handling', req.url, err)
        res.statusCode = 500
        res.end('internal server error')
      }
    })

    server.listen(port, hostname, (err) => {
      if (err) throw err
      console.log(`> Ready on https://${hostname === '0.0.0.0' ? 'localhost' : hostname}:${port}`)
      console.log(`> Access via IP: https://<your-ip>:${port}`)
      console.log(`> You'll need to accept the self-signed certificate warning`)
    })
  })
} else {
  console.warn('⚠️  HTTPS certificates not found. Run: ./generate-cert.sh')
  console.warn('   Falling back to HTTP (microphone will not work over IP)')
  app.prepare().then(() => {
    const http = require('http')
    server = http.createServer(async (req, res) => {
      try {
        const parsedUrl = parse(req.url, true)
        await handle(req, res, parsedUrl)
      } catch (err) {
        console.error('Error occurred handling', req.url, err)
        res.statusCode = 500
        res.end('internal server error')
      }
    })

    server.listen(port, hostname, (err) => {
      if (err) throw err
      console.log(`> Ready on http://${hostname === '0.0.0.0' ? 'localhost' : hostname}:${port}`)
    })
  })
}
