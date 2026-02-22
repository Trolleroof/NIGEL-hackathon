#!/bin/bash
# Generate self-signed certificate for HTTPS development
# Usage: ./generate-cert.sh [IP_ADDRESS]
# Example: ./generate-cert.sh 100.81.34.76

if [ -z "$1" ]; then
  echo "Usage: ./generate-cert.sh <YOUR_IP_ADDRESS>"
  echo "Example: ./generate-cert.sh 100.81.34.76"
  echo ""
  echo "To find your IP address:"
  echo "  macOS/Linux: ifconfig | grep 'inet '"
  echo "  Windows: ipconfig"
  exit 1
fi

IP=$1
DOMAIN="localhost"

echo "🔐 Generating self-signed certificate for $IP and $DOMAIN..."
echo ""

mkdir -p certificates

# Generate private key
openssl genrsa -out certificates/server-key.pem 2048

# Generate certificate signing request
openssl req -new -key certificates/server-key.pem -out certificates/server.csr -subj "/CN=$DOMAIN"

# Generate self-signed certificate with IP and localhost in SAN
openssl x509 -req -in certificates/server.csr -signkey certificates/server-key.pem -out certificates/server-cert.pem -days 365 -extensions v3_req -extfile <(
cat <<EOF
[v3_req]
subjectAltName = @alt_names
[alt_names]
IP.1 = $IP
DNS.1 = $DOMAIN
DNS.2 = localhost
EOF
)

rm certificates/server.csr

echo "✅ Certificate generated successfully!"
echo ""
echo "📝 Next steps:"
echo "  1. Run: npm run dev"
echo "  2. Access your app at: https://$IP:3000"
echo "  3. Accept the security warning in your browser (it's safe for local dev)"
echo ""
echo "⚠️  Note: You may need to accept the certificate warning each time you open the site."
