ARG PHP_VERSION=8.5
 
FROM php:${PHP_VERSION}-apache
 
# Install database and Gmail API extensions
RUN apt-get update \
    && apt-get install -y --no-install-recommends libcurl4-openssl-dev libsqlite3-dev \
    && docker-php-ext-install pdo_mysql pdo_sqlite curl \
    && rm -rf /var/lib/apt/lists/*
 
# Enable Apache mod_rewrite
RUN a2enmod rewrite
 
# Allow .htaccess overrides
RUN sed -i '/<Directory \/var\/www\/>/,/<\/Directory>/ s/AllowOverride None/AllowOverride All/' /etc/apache2/apache2.conf
 
# Copy app files
COPY . /var/www/html/
 
# Fix permissions
RUN chown -R www-data:www-data /var/www/html \
&& chmod -R 755 /var/www/html

# Point Apache document root to public/
RUN sed -i 's|DocumentRoot /var/www/html|DocumentRoot /var/www/html/public|g' /etc/apache2/sites-available/000-default.conf

EXPOSE 10000

CMD ["sh", "-c", "port=${PORT:-10000}; sed -ri \"s/^Listen .*/Listen ${port}/\" /etc/apache2/ports.conf; sed -ri \"s/<VirtualHost \\*:80>/<VirtualHost *:${port}>/\" /etc/apache2/sites-available/000-default.conf; exec apache2-foreground"]