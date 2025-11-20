import { createClient } from '@supabase/supabase-js';

const adminSupabase = createClient(
    process.env.ADMIN_SUPABASE_URL,
    process.env.ADMIN_SUPABASE_KEY
);

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const {
            brand,
            orderId, // Brand's order ID
            paymentIntentId,
            status, // 'paid' or 'failed'
            brandDatabaseUrl,
            brandDatabaseKey,
        } = req.body;

        // 1. Update admin database
        const { error: adminError } = await adminSupabase
            .from('orders')
            .schema('admin')
            .update({
                status: status,
                payment_method: 'card',
                paid_at: status === 'paid' ? new Date().toISOString() : null,
                updated_at: new Date().toISOString(),
            })
            .eq('stripe_payment_intent_id', paymentIntentId);

        if (adminError) {
            console.error('Admin DB update error:', adminError);
        }

        // 2. Update brand's database (if credentials provided)
        if (brandDatabaseUrl && brandDatabaseKey) {
            const brandSupabase = createClient(brandDatabaseUrl, brandDatabaseKey);

            const { error: brandError } = await brandSupabase
                .from('orders')
                .update({
                    payment_status: status,
                    stripe_payment_intent_id: paymentIntentId,
                    paid_at: status === 'paid' ? new Date().toISOString() : null,
                })
                .eq('id', orderId);

            if (brandError) {
                console.error('Brand DB update error:', brandError);
            }
        }

        return res.status(200).json({
            success: true,
            adminUpdated: !adminError,
            brandUpdated: brandDatabaseUrl ? true : false,
        });

    } catch (error) {
        console.error('Update payment status error:', error);
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
}