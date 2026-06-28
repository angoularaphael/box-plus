<?php
/**
 * Module PrestaShop — envoie les ventes vers BOXPLUS (pas d'annulation automatique).
 */
if (!defined('_PS_VERSION_')) {
    exit;
}

class BoxplusBridge extends Module
{
    public function __construct()
    {
        $this->name = 'boxplusbridge';
        $this->tab = 'administration';
        $this->version = '1.3.0';
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
            && Configuration::updateValue('BOXPLUS_WEBHOOK_SECRET', '');
    }

    public function getContent()
    {
        if (Tools::isSubmit('submitBoxplusBridge')) {
            Configuration::updateValue('BOXPLUS_WEBHOOK_URL', Tools::getValue('BOXPLUS_WEBHOOK_URL'));
            Configuration::updateValue('BOXPLUS_WEBHOOK_SECRET', Tools::getValue('BOXPLUS_WEBHOOK_SECRET'));
        }
        $url = Configuration::get('BOXPLUS_WEBHOOK_URL');
        $secret = Configuration::get('BOXPLUS_WEBHOOK_SECRET');
        return '<form method="post"><label>Webhook URL</label><input name="BOXPLUS_WEBHOOK_URL" value="' . htmlspecialchars($url) . '" /><br/><label>Secret HMAC</label><input name="BOXPLUS_WEBHOOK_SECRET" value="' . htmlspecialchars($secret) . '" /><br/><button name="submitBoxplusBridge">Enregistrer</button></form>';
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
            'gym' => $this->extractGym($order, $main),
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

    protected function extractGym($order, $product)
    {
        return 'minimes';
    }

    protected function extractIban($order)
    {
        $message = Tools::strtolower(trim($order->note));
        if (preg_match('/\bfr\d{2}[a-z0-9]{23}\b/i', str_replace(' ', '', $message), $m)) {
            return strtoupper($m[0]);
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
