import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { buffer } from 'micro';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
    process.env.ADMIN_SUPABASE_URL,
    process.env.ADMIN_SUPABASE_ANON_KEY
);

export const config = {
    api: {
        bodyParser: false,
    },
};

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).end();
    }

    const buf = await buffer(req);
    const sig = req.headers['stripe-signature'];

    let event;

    try {
        event = stripe.webhooks.constructEvent(
            buf,
            sig,
            process.env.STRIPE_WEBHOOK_SECRET
        );
    } catch (err) {
        console.error('Webhook signature verification failed:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle the event
    switch (event.type) {
        case 'payment_intent.succeeded':
            const paymentIntent = event.data.object;

            // Update admin database
            await supabase
                .from('orders')
                .update({
                    status: 'paid',
                    stripe_charge_id: paymentIntent.latest_charge,
                    paid_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                })
                .eq('stripe_payment_intent_id', paymentIntent.id);

            console.log('Payment succeeded:', paymentIntent.id);
            break;

        case 'payment_intent.payment_failed':
            const failedIntent = event.data.object;

            await supabase
                .from('orders')
                .update({
                    status: 'failed',
                    updated_at: new Date().toISOString(),
                })
                .eq('stripe_payment_intent_id', failedIntent.id);

            console.log('Payment failed:', failedIntent.id);
            break;

        default:
            console.log(`Unhandled event type ${event.type}`);
    }

    res.json({ received: true });
}