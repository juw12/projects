#!/usr/bin/env bash
set -euo pipefail

DOMAIN="${1:-yourdomain.com}"
APP_DIR="/opt/respark"
SERVICE_USER="respark"

if [ "$DOMAIN" = "yourdomain.com" ]; then
    echo "Usage: $0 <your-domain.com>"
    exit 1
fi

echo "==> Creating service user"
id -u "$SERVICE_USER" >/dev/null 2>&1 || useradd --system --shell /usr/sbin/nologin --home "$APP_DIR" "$SERVICE_USER"

echo "==> Installing app to $APP_DIR"
mkdir -p "$APP_DIR" /var/log/respark
cp -r server web tests.py "$APP_DIR/"
cp .env.example "$APP_DIR/.env"
chown -R "$SERVICE_USER:$SERVICE_USER" "$APP_DIR" /var/log/respark

echo "==> Generating RESPARK_SECRET"
SECRET=$(python3 -c "import secrets; print(secrets.token_urlsafe(48))")
sed -i "s|^RESPARK_SECRET=.*|RESPARK_SECRET=$SECRET|" "$APP_DIR/.env"
sed -i "s|^RESPARK_BASE_URL=.*|RESPARK_BASE_URL=https://$DOMAIN|" "$APP_DIR/.env"

echo "==> Installing systemd unit"
cp respark.service /etc/systemd/system/respark.service
systemctl daemon-reload
systemctl enable respark
systemctl start respark

echo "==> Installing nginx"
apt-get install -y nginx certbot python3-certbot-nginx >/dev/null
sed "s/yourdomain.com/$DOMAIN/g" nginx.conf > /etc/nginx/sites-available/respark
ln -sf /etc/nginx/sites-available/respark /etc/nginx/sites-enabled/respark
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

echo "==> Provisioning SSL"
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "admin@$DOMAIN" || \
    certbot --nginx -d "$DOMAIN" --agree-tos -m "admin@$DOMAIN"

echo
echo "Done."
echo "  App:     https://$DOMAIN"
echo "  Health:  systemctl status respark"
echo "  Logs:    tail -f /var/log/respark/app.log"
echo
echo "Next: edit /opt/respark/.env with your Stripe keys and SMTP creds, then:"
echo "  systemctl restart respark"
