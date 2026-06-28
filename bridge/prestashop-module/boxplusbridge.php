<?php
/**
 * Module PrestaShop — envoie les ventes vers BOXPLUS (pas d'annulation automatique).
 */
if (!defined('_PS_VERSION_')) {
    exit;
}

class BoxplusBridge extends Module
{
    /** Slugs alignés sur config/gym-mapping.json et la boutique Stripe. */
    const GYM_SLUGS = [
        'st-cyprien',
        'minimes',
        'ramonville',
        'portet',
        'etats-unis',
        'balma',
    ];

    public function __construct()
    {
        $this->name = 'boxplusbridge';
        $this->tab = 'administration';
        $this->version = '1.4.0';
        $this->author = 'Boxing Center';
        $this->need_instance = 0;
        parent::__construct();
        $this->displayName = $this->l('BOXPLUS Deciplus Bridge');
        $this->description = $this->l('Transfère les ventes PrestaShop vers Deciplus via BOXPLUS');
    }

    public function install()
    {
        return parent::install()
            && $this->registerHook('actionValidateOrder')
            && Configuration::updateValue('BOXPLUS_WEBHOOK_URL', '')
            && Configuration::updateValue('BOXPLUS_WEBHOOK_SECRET', '')
            && Configuration::updateValue('BOXPLUS_DEFAULT_GYM', 'minimes');
    }

    public function getContent()
    {
        if (Tools::isSubmit('submitBoxplusBridge')) {
            Configuration::updateValue('BOXPLUS_WEBHOOK_URL', Tools::getValue('BOXPLUS_WEBHOOK_URL'));
            Configuration::updateValue('BOXPLUS_WEBHOOK_SECRET', Tools::getValue('BOXPLUS_WEBHOOK_SECRET'));
            $defaultGym = Tools::getValue('BOXPLUS_DEFAULT_GYM');
            Configuration::updateValue(
                'BOXPLUS_DEFAULT_GYM',
                $this->isValidGymSlug($defaultGym) ? $defaultGym : 'minimes'
            );
        }

        $url = Configuration::get('BOXPLUS_WEBHOOK_URL');
        $secret = Configuration::get('BOXPLUS_WEBHOOK_SECRET');
        $defaultGym = Configuration::get('BOXPLUS_DEFAULT_GYM') ?: 'minimes';
        if (!$this->isValidGymSlug($defaultGym)) {
            $defaultGym = 'minimes';
        }

        $gymOptions = '';
        foreach (self::GYM_SLUGS as $slug) {
            $selected = $slug === $defaultGym ? ' selected' : '';
            $gymOptions .= '<option value="' . htmlspecialchars($slug) . '"' . $selected . '>' . htmlspecialchars($slug) . '</option>';
        }

        return '
            <form method="post">
                <fieldset>
                    <legend>BOXPLUS Bridge</legend>
                    <label>Webhook URL</label><br/>
                    <input name="BOXPLUS_WEBHOOK_URL" value="' . htmlspecialchars($url) . '" style="width:420px" /><br/><br/>
                    <label>Secret HMAC</label><br/>
                    <input name="BOXPLUS_WEBHOOK_SECRET" value="' . htmlspecialchars($secret) . '" style="width:420px" /><br/><br/>
                    <label>Salle par défaut (si non détectée au checkout)</label><br/>
                    <select name="BOXPLUS_DEFAULT_GYM">' . $gymOptions . '</select><br/><br/>
                    <p><em>La salle client est lue automatiquement depuis le message de commande, l\'adresse ou un champ du type <code>Salle: minimes</code> / <code>gym=ramonville</code> — mêmes slugs que la boutique BOXPLUS.</em></p>
                    <button name="submitBoxplusBridge">Enregistrer</button>
                </fieldset>
            </form>';
    }

    public function hookActionValidateOrder($params)
    {
        $order = $params['order'];
        if (!Validate::isLoadedObject($order)) {
            return;
        }
        $customer = new Customer($order->id_customer);
        $address = new Address($order->id_address_delivery);
        $payload = $this->buildSalePayload($order, $customer, $address);
        $this->sendWebhook($payload);
    }

    protected function buildSalePayload($order, $customer, $address)
    {
        $products = $order->getProducts();
        $main = isset($products[0]) ? $products[0] : null;
        $productName = $main ? $main['product_name'] : '';
        $productReference = $main ? $main['product_reference'] : '';

        return [
            'action' => 'sale',
            'order_id' => 'PS-' . $order->id,
            'product_name' => $productName,
            'product_reference' => $productReference,
            'gym' => $this->extractGym($order, $products, $address),
            'customer' => $this->customerPayload($customer, $address),
            'payment' => [
                'amount' => (float) $order->total_paid_tax_incl,
                'method' => $order->payment,
                'status' => 'paid',
                'date' => $order->date_add,
                'iban' => $this->extractIban($order),
            ],
            'utm' => [],
            'source' => 'prestashop',
        ];
    }

    protected function customerPayload($customer, $address)
    {
        return [
            'first_name' => $customer->firstname,
            'last_name' => $customer->lastname,
            'email' => $customer->email,
            'phone' => $address->phone_mobile ?: $address->phone,
            'birthdate' => null,
            'gender' => null,
            'address' => $address->address1,
            'postal_code' => $address->postcode,
            'city' => $address->city,
            'country' => $address->country,
        ];
    }

    /**
     * Détecte la salle choisie au checkout (slugs BOXPLUS / Deciplus).
     */
    protected function extractGym($order, $products, $address)
    {
        $candidates = [];

        foreach ($this->collectGymTextSources($order, $products, $address) as $text) {
            $slug = $this->matchGymSlug($text);
            if ($slug) {
                $candidates[] = $slug;
            }
        }

        if (!empty($candidates)) {
            return $candidates[0];
        }

        $default = Configuration::get('BOXPLUS_DEFAULT_GYM') ?: 'minimes';
        return $this->isValidGymSlug($default) ? $default : 'minimes';
    }

    protected function collectGymTextSources($order, $products, $address)
    {
        $texts = [];

        if (Validate::isLoadedObject($address)) {
            foreach (['alias', 'company', 'address1', 'address2', 'other', 'city'] as $field) {
                if (!empty($address->$field)) {
                    $texts[] = (string) $address->$field;
                }
            }
        }

        if (!empty($order->gift_message)) {
            $texts[] = (string) $order->gift_message;
        }
        if (!empty($order->note)) {
            $texts[] = (string) $order->note;
        }

        foreach ($this->getOrderMessages($order) as $message) {
            $texts[] = $message;
        }

        if (is_array($products)) {
            foreach ($products as $line) {
                foreach (['product_name', 'product_reference', 'product_attribute_name'] as $field) {
                    if (!empty($line[$field])) {
                        $texts[] = (string) $line[$field];
                    }
                }
            }
        }

        return array_values(array_filter(array_unique($texts)));
    }

    protected function getOrderMessages($order)
    {
        $messages = [];

        if (!empty($order->id_cart)) {
            $cartMessage = Message::getMessageByCartId((int) $order->id_cart);
            if (Validate::isLoadedObject($cartMessage) && !empty($cartMessage->message)) {
                $messages[] = (string) $cartMessage->message;
            }
        }

        if (!empty($order->id)) {
            $orderMessages = Message::getMessagesByOrderId((int) $order->id);
            if (is_array($orderMessages)) {
                foreach ($orderMessages as $row) {
                    if (!empty($row['message'])) {
                        $messages[] = (string) $row['message'];
                    }
                }
            }
        }

        return $messages;
    }

    protected function matchGymSlug($raw)
    {
        $text = $this->normalizeGymText($raw);
        if ($text === '') {
            return null;
        }

        if ($this->isValidGymSlug($text)) {
            return $text;
        }

        if (preg_match('/(?:gym|salle)\s*[:=]\s*([a-z0-9][a-z0-9\-]*)/i', $text, $matches)) {
            $explicit = $this->normalizeGymText($matches[1]);
            if ($this->isValidGymSlug($explicit)) {
                return $explicit;
            }
            $fromExplicit = $this->matchGymLabel($explicit);
            if ($fromExplicit) {
                return $fromExplicit;
            }
        }

        return $this->matchGymLabel($text);
    }

    protected function matchGymLabel($text)
    {
        $labels = [
            'st-cyprien' => ['st-cyprien', 'st cyprien', 'saint-cyprien', 'saint cyprien', 'boxing center st-cyprien', 'boxing center st cyprien'],
            'minimes' => ['minimes', 'boxing center minimes'],
            'ramonville' => ['ramonville', 'boxing center ramonville'],
            'portet' => ['portet', 'portet-sur-garonne', 'boxing center portet'],
            'etats-unis' => ['etats-unis', 'etats unis', 'boxing center etats-unis', 'boxing center etats unis'],
            'balma' => ['balma', 'boxing center balma'],
        ];

        foreach ($labels as $slug => $aliases) {
            foreach ($aliases as $alias) {
                if ($text === $alias || strpos($text, $alias) !== false) {
                    return $slug;
                }
            }
        }

        return null;
    }

    protected function normalizeGymText($raw)
    {
        $text = Tools::strtolower(trim(strip_tags((string) $raw)));
        $text = str_replace(['é', 'è', 'ê', 'ë', 'à', 'â', 'ù', 'û', 'î', 'ï', 'ô', 'ö', 'ç'], ['e', 'e', 'e', 'e', 'a', 'a', 'u', 'u', 'i', 'i', 'o', 'o', 'c'], $text);
        $text = preg_replace('/[^a-z0-9\s\-]/', ' ', $text);
        $text = preg_replace('/\s+/', ' ', $text);
        $text = trim($text);

        if ($text === '') {
            return '';
        }

        if (strpos($text, ' ') !== false && strpos($text, '-') === false) {
            return str_replace(' ', '-', $text);
        }

        return $text;
    }

    protected function isValidGymSlug($slug)
    {
        return in_array((string) $slug, self::GYM_SLUGS, true);
    }

    protected function extractIban($order)
    {
        $chunks = [];
        if (!empty($order->note)) {
            $chunks[] = (string) $order->note;
        }
        if (!empty($order->gift_message)) {
            $chunks[] = (string) $order->gift_message;
        }
        foreach ($this->getOrderMessages($order) as $message) {
            $chunks[] = $message;
        }

        foreach ($chunks as $message) {
            $compact = str_replace(' ', '', Tools::strtolower(trim($message)));
            if (preg_match('/\bfr\d{2}[a-z0-9]{23}\b/i', $compact, $matches)) {
                return strtoupper($matches[0]);
            }
        }

        return null;
    }

    protected function sendWebhook(array $payload)
    {
        $url = Configuration::get('BOXPLUS_WEBHOOK_URL');
        $secret = Configuration::get('BOXPLUS_WEBHOOK_SECRET');
        if (!$url) {
            return false;
        }
        $body = json_encode($payload);
        $signature = hash_hmac('sha256', $body, $secret);
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_HTTPHEADER => [
                'Content-Type: application/json',
                'X-Boxplus-Signature: ' . $signature,
            ],
            CURLOPT_POSTFIELDS => $body,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 10,
        ]);
        curl_exec($ch);
        curl_close($ch);
        return true;
    }
}
