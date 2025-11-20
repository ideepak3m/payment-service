import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
    process.env.ADMIN_SUPABASE_URL,
    process.env.ADMIN_SUPABASE_KEY
);

export default async function handler(req, res) {
    // CORS headers

    // Dynamic CORS: allow localhost and production
    const allowedOrigins = [
        'http://localhost:8080',
        'https://your-production-frontend.com' // <-- replace with your real production frontend URL
    ];
    const origin = req.headers.origin;
    if (allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    } else {
        res.setHeader('Access-Control-Allow-Origin', allowedOrigins[0]);
    }
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');


    if (req.method === 'OPTIONS') {
        // Preflight request: respond with only the CORS headers
        console.log('Preflight OPTIONS request received');
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        // Always set CORS headers for error responses too
        console.log('POST options for error received:');
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const {
            orderId,
            orderNumber,
            brand,
            product,
            amount,
            currency = 'cad',
            customerEmail,
            customerName,
        } = req.body;

        // Validate required fields
        if (!orderId || !brand || !amount || !customerEmail) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields'
            });
        }

        // 1. Create record in admin database
        const { data: orderRecord, error: dbError } = await supabase
            .from('admin.orders')
            .insert({
                order_number: orderNumber,
                brand: brand,
                product: product,
                amount: amount,
                currency: currency,
                customer_email: customerEmail,
                customer_name: customerName,
                status: 'pending_payment',
                metadata: {
                    brand_order_id: orderId,
                    brand_order_number: orderNumber,
                }
            })
            .select()
            .single();

        if (dbError) {
            console.error('Database error:', dbError);
            return res.status(500).json({
                success: false,
                error: 'Failed to create payment record'
            });
        }

        // 2. Create Stripe Payment Intent
        const paymentIntent = await stripe.paymentIntents.create({
            amount: amount,
            currency: currency,
            description: `${brand} - Order ${orderNumber || orderId}`,
            receipt_email: customerEmail,
            metadata: {
                brand: brand,
                order_number: orderNumber,
                brand_order_id: orderId,
                admin_order_id: orderRecord.id,
            },
        });

        // 3. Update admin record with Stripe Payment Intent ID
        await supabase
            .from('admin.orders')
            .update({
                stripe_payment_intent_id: paymentIntent.id,
                updated_at: new Date().toISOString(),
            })
            .eq('id', orderRecord.id);

        // 4. Return client secret to frontend
        return res.status(200).json({
            success: true,
            clientSecret: paymentIntent.client_secret,
            paymentIntentId: paymentIntent.id,
            adminOrderId: orderRecord.id,
        });

    } catch (error) {
        console.error('Payment intent creation error:', error);
        return res.status(500).json({
            success: false,
            error: error.message || 'Failed to create payment intent'
        });
    }
}