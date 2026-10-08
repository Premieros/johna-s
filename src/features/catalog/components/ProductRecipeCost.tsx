import { useEffect,useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { formatFinancialCurrency,formatNumber } from '@/lib/format';
import { estimateRecipeCost,type RawCostLine } from '@/lib/recipeCosting';
import { loadRecipeEstimateData } from '@/features/costing/services/recipeEstimateData';

type Props={branchId:string; ingredients:RawCostLine[]; groups:{unit_id:string;quantity:number}[];yieldQuantity:number;salePrice:number};

export function ProductRecipeCost({branchId,ingredients,groups,yieldQuantity,salePrice}:Props){
  const {lang}=useLanguage();const isAr=lang==='ar';
  const [data,setData]=useState<Awaited<ReturnType<typeof loadRecipeEstimateData>>|null>(null);
  const [error,setError]=useState<string|null>(null);
  const [loading,setLoading]=useState(true);
  useEffect(()=>{
    let active=true;setData(null);setError(null);setLoading(true);
    void loadRecipeEstimateData(branchId).then(result=>{if(active)setData(result);})
      .catch(reason=>{if(active)setError(reason instanceof Error?reason.message:String(reason));})
      .finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[branchId]);
  const estimate=data?estimateRecipeCost(ingredients,groups,data.prices,data.groupCosts,yieldQuantity):null;
  const cost=estimate?.unitCost??null;
  const margin=cost!==null&&salePrice>0?(salePrice-cost)*100/salePrice:null;
  return <div data-testid="product-recipe-cost" className="rounded-xl border border-ui-border bg-ui-page-alt p-3 space-y-2">
    <p className="font-semibold text-ui-text">{isAr?'تكلفة الوصفة / وحدة بيع (تقديرية)':'Recipe cost / sale unit (estimated)'}</p>
    {loading?<p className="text-sm text-ui-subtle">{isAr?'جاري تحميل أسعار الخامات…':'Loading raw prices…'}</p>:error?<p role="alert" className="text-sm text-ui-danger">{error}</p>:<>
      <p className="font-bold text-ui-primary">{cost===null?(isAr?'غير مكتملة':'Incomplete'):formatFinancialCurrency(cost,'EGP',lang)}</p>
      {estimate?.incomplete&&<p role="status" className="text-sm text-ui-warning">{isAr?'تحقق من مجموعات المكونات وكمية ناتج الوصفة لحساب التكلفة.':'Check component groups and recipe yield to calculate cost.'}</p>}
      <p className="text-sm text-ui-muted">{isAr?'هامش الربح المتوقع:':'Expected margin:'} {margin===null?'—':`${formatNumber(margin,1)}%`}</p>
    </>}
    <p className="text-xs text-ui-subtle">{isAr?'حسب المكونات والكميات الحالية وآخر أسعار الخامات؛ تتحدث مع تعديل الوصفة.':'Uses current component quantities and latest raw prices; updates with recipe edits.'}</p>
  </div>;
}
