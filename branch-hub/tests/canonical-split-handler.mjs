// CI fixture ONLY. Synthetic auth GUC/subscription setup must not be deployed.
export function makeCanonicalSplitHandler({warehouseId,shiftId},beforeReturn){
  return async({tx,context,operation})=>{
    await tx.query("SELECT set_config('app.user_id',$1,true)",[context.userId]);
    await tx.exec('SET LOCAL ROLE authenticated');
    let result;
    try{
      result=(await tx.query(`SELECT public.process_sale_split_idempotent(
        p_client_operation_key:=$1,p_invoice_number:=$2,p_branch_id:=$3,p_warehouse_id:=$4,
        p_customer_id:=NULL,p_salesperson_id:=NULL,p_subtotal:=20,p_discount_amount:=0,p_discount_type:='amount',
        p_tax_amount:=0,p_bonus_amount:=0,p_total:=20,p_payments:=$5::jsonb,p_status:='completed',p_items:=$6::jsonb,
        p_shift_id:=$7,p_order_type:='takeaway',p_table_id:=NULL,p_order_id:=NULL,p_guest_count:=NULL) AS result`,
        [operation.operationId,`LOCAL-ATOMIC-${operation.operationId}`,context.branchId,warehouseId,
          JSON.stringify(operation.payload.payments),JSON.stringify(operation.payload.items),shiftId])).rows[0].result;
    }finally{await tx.exec('RESET ROLE; RESET app.user_id');}
    if(result?.success===true&&beforeReturn)await beforeReturn();
    return result;
  };
}
