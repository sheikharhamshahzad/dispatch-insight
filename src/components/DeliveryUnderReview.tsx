import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import {
  buildWhatsAppUrl,
  formatPakistanPhoneForWhatsApp,
  getPreviousAttemptsHistory,
  formatPreviousAttempts,
} from "@/services/deliveryReviewHelpers";
import { 
  markDeliveryReviewWhatsAppSent, 
  updateDeliveryReviewStatus,
  markCustomerWhatsAppSent,
  markSalesWhatsAppSent,
  markPostExEmailSent
} from "@/services/deliveryReviewService";
import { requestReattempt } from "@/services/reattemptService";
import { updateTrackingHistoryForReview, updateTrackingHistoryForDeliveryReviews } from "@/services/trackingHistoryService";
import {
  MessageCircle,
  Phone,
  CheckCircle,
  XCircle,
  Clock,
  AlertCircle,
  RefreshCw,
  TrendingUp,
  Calendar,
  User,
  CalendarIcon,
  History,
  ExternalLink,
  Zap,
  Send,
  Lightbulb,
  Copy,
  ChevronDown,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Textarea } from "@/components/ui/textarea";
import { format, subDays, startOfDay, endOfDay, subHours } from "date-fns";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DateRange } from "react-day-picker";
import { cn } from "@/lib/utils";

interface DeliveryReview {
  id: string;
  tracking_number: string;
  order_ref_number: string;
  customer_name: string;
  customer_phone: string;
  customer_city: string;
  delivery_address: string;
  order_detail: string;
  order_amount: number | null;
  dispatch_date: string;
  attempt_date: string;
  review_reason_code: string;
  review_reason_label: string;
  review_reason_display: string;
  current_order_status: string;
  review_status: string;
  whatsapp_sent: boolean;
  whatsapp_sent_at: string | null;
  customer_response: string | null;
  courier_action: string;
  final_outcome: string;
  completed_at: string | null;
  notes: string | null;
  raw_postex_response: any;
  reattempt_requested: boolean;
  reattempt_requested_at: string | null;
  reattempt_remarks: string | null;
  postex_reattempt_response: any;
  customer_whatsapp_sent: boolean;
  customer_whatsapp_sent_at: string | null;
  sales_whatsapp_sent: boolean;
  sales_whatsapp_sent_at: string | null;
  postex_email_sent: boolean;
  postex_email_sent_at: string | null;
  created_at: string;
}

interface DashboardStats {
  totalUnderReview: number;
  closedCases: number;
  whatsappSent: number;
  reattemptRequested: number;
  deliveredAfterFollowup: number;
  returnedConfirmed: number;
  fakeAttempts: number;
}

export function DeliveryUnderReview() {
  const { toast } = useToast();
  const [reviews, setReviews] = useState<DeliveryReview[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [date, setDate] = useState<DateRange | undefined>({
    from: startOfDay(new Date()),
    to: endOfDay(new Date()),
  });
  const [useCustomDateRange, setUseCustomDateRange] = useState(false);
  const [stats, setStats] = useState<DashboardStats>({
    totalUnderReview: 0,
    closedCases: 0,
    whatsappSent: 0,
    reattemptRequested: 0,
    deliveredAfterFollowup: 0,
    returnedConfirmed: 0,
    fakeAttempts: 0,
  });
  const [selectedReview, setSelectedReview] = useState<DeliveryReview | null>(null);
  const [showActionDialog, setShowActionDialog] = useState<boolean>(false);
   const [actionType, setActionType] = useState<
     "whatsapp" | "mark_contacted" | "reattempt" | "close_case" | "mark_completed"
   >("whatsapp");
  const [searchTrackingNumber, setSearchTrackingNumber] = useState("");
  const [searchOrderNumber, setSearchOrderNumber] = useState("");
  const [showHistoryDialog, setShowHistoryDialog] = useState(false);
  const [historyReview, setHistoryReview] = useState<DeliveryReview | null>(null);
  const [showReattemptDialog, setShowReattemptDialog] = useState(false);
  const [reattemptReview, setReattemptReview] = useState<DeliveryReview | null>(null);
  const [reattemptRemarks, setReattemptRemarks] = useState("Customer confirmed the order. Please arrange reattempt delivery as soon as possible.");
   const [isReattemptLoading, setIsReattemptLoading] = useState(false);
    const [isAutoRefreshActive, setIsAutoRefreshActive] = useState(true);
    const [showWhatsAppSalesDialog, setShowWhatsAppSalesDialog] = useState(false);
    const [whatsAppSalesReview, setWhatsAppSalesReview] = useState<DeliveryReview | null>(null);
    const [whatsAppSalesMessage, setWhatsAppSalesMessage] = useState("");
    const [showEmailDialog, setShowEmailDialog] = useState(false);
    const [emailReview, setEmailReview] = useState<DeliveryReview | null>(null);
    const [emailMessage, setEmailMessage] = useState("");
    const [expandedSections, setExpandedSections] = useState({
      readyForReattempt: true,
      reattemptRequested: true,
      openReviews: true,
      completedReviews: true,
    });

   // Fetch reviews based on date range
   useEffect(() => {
     fetchReviews();
   }, [date, useCustomDateRange]);

    // Auto-refresh tracking history for open reviews
    useEffect(() => {
      if (!isAutoRefreshActive) return;

      // Set up interval to refresh tracking history every 5 minutes
      const autoRefreshInterval = setInterval(async () => {
        try {
          console.log("[AutoRefresh] Starting automatic tracking history update...");
          const result = await updateTrackingHistoryForDeliveryReviews();
          
          if (result.success) {
            console.log(`[AutoRefresh] Successfully updated ${result.updatedCount} reviews`);
            // Only refresh open reviews, not all reviews
            // This prevents completed reviews from being re-fetched and reappearing
            const fromDate = date?.from || startOfDay(new Date());
            const toDate = date?.to || endOfDay(new Date());
            const fromStr = format(fromDate, 'yyyy-MM-dd');
            const toNextDay = new Date(toDate.getFullYear(), toDate.getMonth(), toDate.getDate() + 1);
            const toNextDayStr = format(toNextDay, 'yyyy-MM-dd');

            const { data, error } = await supabase
              .from("delivery_reviews")
              .select("*")
              .gte("attempt_date", fromStr)
              .lt("attempt_date", toNextDayStr)
              .in("review_status", ["open", "courier_followup"])
              .order("order_ref_number", { ascending: false });

            if (!error && data) {
              // Merge the updated open reviews with existing completed reviews.
              // IMPORTANT: We use the freshly-fetched open reviews to determine
              // which IDs are still "open" in the DB, and treat everything else
              // already in state as completed (or otherwise non-open). This
              // prevents a review that was closed locally from accidentally
              // being treated as "open" again just because the auto-refresh
              // query happened to return it before the close persisted.
              setReviews((prevReviews) => {
                const updatedOpenReviews = data as DeliveryReview[];
                const openIds = new Set(updatedOpenReviews.map((r) => r.id));
                // Keep any existing review that is NOT in the fresh open set
                // (these are completed/closed and should be preserved so the
                // Completed Reviews section and Closed Cases count stay correct).
                const nonOpenReviews = prevReviews.filter((r) => !openIds.has(r.id));
                const merged = [...updatedOpenReviews, ...nonOpenReviews];
                // Refresh stats from the merged list
                const fromDate = date?.from || startOfDay(new Date());
                const toDate = date?.to || endOfDay(new Date());
                calculateStats(merged, fromDate, toDate);
                return merged;
              });
            }
          } else {
            console.warn("[AutoRefresh] Update failed:", result.error);
          }
        } catch (error) {
          console.error("[AutoRefresh] Error during automatic update:", error);
        }
      }, 5 * 60 * 1000); // 5 minutes

      return () => clearInterval(autoRefreshInterval);
    }, [isAutoRefreshActive, date]);

  const handleDateSelect = (selectedDate: DateRange | undefined) => {
    setDate(selectedDate);
    if (selectedDate?.from) {
      setUseCustomDateRange(true);
    }
  };

  const clearDateSelection = () => {
    setDate({
      from: startOfDay(new Date()),
      to: endOfDay(new Date()),
    });
    setUseCustomDateRange(false);
  };

  const setQuickDate = (days: number) => {
    const to = endOfDay(new Date());
    const from = startOfDay(subDays(new Date(), days));
    setDate({ from, to });
    setUseCustomDateRange(true);
  };

   const fetchReviews = async () => {
     setIsLoading(true);
     try {
       // Use custom date range if selected, otherwise use Today
       const fromDate = date?.from || startOfDay(new Date());
       const toDate = date?.to || endOfDay(new Date());

       // Format dates as YYYY-MM-DD for proper date filtering
       const fromStr = format(fromDate, 'yyyy-MM-dd');
       const toNextDay = new Date(toDate.getFullYear(), toDate.getMonth(), toDate.getDate() + 1);
       const toNextDayStr = format(toNextDay, 'yyyy-MM-dd');

       // Fetch BOTH open and completed reviews for the selected period.
       // We need completed reviews so the "Completed Reviews" section renders
       // and the "Closed Cases" stat is accurate. Filtering between
       // open/completed is handled later in the component using
       // `review_status`.
       let query = supabase
         .from("delivery_reviews")
         .select("*")
         .gte("attempt_date", fromStr)
         .lt("attempt_date", toNextDayStr)
         .order("order_ref_number", { ascending: false }); // Sort by order ref number descending (bigger numbers first)

      const { data, error } = await query;

      if (error) {
        console.error("Error fetching delivery reviews:", error);
        toast({
          title: "Error",
          description: "Failed to load delivery reviews",
          variant: "destructive",
        });
        return;
      }

      const reviewsData = (data || []) as DeliveryReview[];
      setReviews(reviewsData);
      calculateStats(reviewsData, fromDate, toDate);
    } catch (error) {
      console.error("Exception fetching reviews:", error);
      toast({
        title: "Error",
        description: "An error occurred while loading reviews",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const calculateStats = (allReviews: DeliveryReview[], fromDate?: Date, toDate?: Date) => {
    // Helper function to check if review is in delivery under review status (0008)
    const isDeliveryUnderReviewStatus = (review: DeliveryReview): boolean => {
      if (!review.raw_postex_response?.transactionStatusHistory) {
        return false;
      }
      const history = review.raw_postex_response.transactionStatusHistory;
      if (!Array.isArray(history) || history.length === 0) {
        return false;
      }
      const latestEntry = history[history.length - 1];
      return latestEntry?.transactionStatusMessageCode === "0008";
    };

    // Count the three under review sections
    // 1. Ready for reattempt: open status + 0008 status
    const readyForReattempt = allReviews.filter((r) => r.review_status === "open" && isDeliveryUnderReviewStatus(r)).length;
    
    // 2. Reattempt requested: with reattempt_requested flag and within date range
    let reattemptRequested = 0;
    if (fromDate && toDate) {
      reattemptRequested = allReviews.filter((r) => {
        if (!r.reattempt_requested || r.review_status === "completed") {
          return false;
        }
        if (!r.reattempt_requested_at) {
          return false;
        }
        const reattemptDate = new Date(r.reattempt_requested_at);
        return reattemptDate >= fromDate && reattemptDate <= toDate;
      }).length;
    } else {
      reattemptRequested = allReviews.filter((r) => r.reattempt_requested && r.review_status !== "completed").length;
    }
    
    // 3. Open reviews: open status + NOT 0008 + NOT reattempt_requested
    const openReviewsCount = allReviews.filter((r) => r.review_status === "open" && !isDeliveryUnderReviewStatus(r) && !r.reattempt_requested).length;
    
    // Total under review = sum of the three sections
    const totalUnderReview = readyForReattempt + reattemptRequested + openReviewsCount;
    
    const closed = allReviews.filter((r) => r.review_status === "completed").length;
    const whatsappSent = allReviews.filter((r) => r.whatsapp_sent).length;
    const delivered = allReviews.filter((r) => r.final_outcome === "delivered_after_followup").length;
    const returned = allReviews.filter((r) => r.final_outcome === "returned_confirmed").length;
    const fake = allReviews.filter((r) => r.final_outcome === "fake_attempt").length;

    setStats({
      totalUnderReview,
      closedCases: closed,
      whatsappSent,
      reattemptRequested,
      deliveredAfterFollowup: delivered,
      returnedConfirmed: returned,
      fakeAttempts: fake,
    });
  };

  const handleWhatsAppClick = (review: DeliveryReview) => {
    const url = buildWhatsAppUrl({
      customer_phone: review.customer_phone,
      customer_name: review.customer_name,
      order_ref_number: review.order_ref_number,
      order_detail: review.order_detail,
      review_reason_code: review.review_reason_code,
    });

    // Mark as customer WhatsApp sent
    markCustomerWhatsAppSent(review.id).then(() => {
      setReviews((prev) =>
        prev.map((r) =>
          r.id === review.id ? { ...r, customer_whatsapp_sent: true, customer_whatsapp_sent_at: new Date().toISOString() } : r
        )
      );
      toast({
        title: "WhatsApp",
        description: "Opening WhatsApp conversation...",
      });
    });

    // Open WhatsApp in new window
    window.open(url, "_blank");
  };

  const handleWhatsAppSalesClick = (review: DeliveryReview) => {
    // Mark as sales WhatsApp sent
    markSalesWhatsAppSent(review.id).then(() => {
      setReviews((prev) =>
        prev.map((r) =>
          r.id === review.id ? { ...r, sales_whatsapp_sent: true, sales_whatsapp_sent_at: new Date().toISOString() } : r
        )
      );
    });
  };

  const handleEmailPostExClick = (review: DeliveryReview) => {
    // Mark as email sent
    markPostExEmailSent(review.id).then(() => {
      setReviews((prev) =>
        prev.map((r) =>
          r.id === review.id ? { ...r, postex_email_sent: true, postex_email_sent_at: new Date().toISOString() } : r
        )
      );
    });
  };

  const handleReattemptClick = (review: DeliveryReview) => {
    if (review.reattempt_requested) {
      toast({
        title: "Reattempt Already Requested",
        description: "A reattempt was already requested for this order. Do you want to send another request?",
        variant: "default",
      });
    }
    setReattemptReview(review);
    setShowReattemptDialog(true);
  };

  const handleSendReattempt = async () => {
    if (!reattemptReview || !reattemptRemarks.trim()) {
      toast({
        title: "Error",
        description: "Remarks cannot be empty",
        variant: "destructive",
      });
      return;
    }

    setIsReattemptLoading(true);
    try {
      const response = await requestReattempt(reattemptReview.id, reattemptRemarks);

      if (response.success) {
        // Update the review in state but keep it in the open reviews section
        // Only update the courier_action and reattempt fields, don't change review_status to "courier_followup"
        const updatedReviews = reviews.map((r) =>
          r.id === reattemptReview.id
            ? {
                ...r,
                reattempt_requested: true,
                reattempt_requested_at: new Date().toISOString(),
                reattempt_remarks: reattemptRemarks,
                courier_action: "reattempt_requested",
                final_outcome: "pending",
                // Keep review_status as "open" so it stays in the open reviews count
              }
            : r
        );
        
        setReviews(updatedReviews);
        toast({
          title: "Success",
          description: "Reattempt requested successfully",
        });
        setShowReattemptDialog(false);
        setReattemptRemarks("Customer confirmed the order. Please arrange reattempt delivery as soon as possible.");
        setReattemptReview(null);
        // Recalculate stats with updated reviews
        const fromDate = date?.from || startOfDay(new Date());
        const toDate = date?.to || endOfDay(new Date());
        calculateStats(updatedReviews, fromDate, toDate);
      } else {
        toast({
          title: "Error",
          description: response.message || "Failed to request reattempt",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Error requesting reattempt:", error);
      toast({
        title: "Error",
        description: "An error occurred while requesting reattempt",
        variant: "destructive",
      });
    } finally {
      setIsReattemptLoading(false);
    }
  };

  const handleAction = async () => {
    if (!selectedReview) return;

    try {
      let updateData: Record<string, any> = {};

      switch (actionType) {
        case "mark_contacted":
          updateData = {
            whatsapp_sent: true,
            whatsapp_sent_at: new Date().toISOString(),
          };
          break;
        case "reattempt":
          updateData = {
            courier_action: "reattempt_requested",
            notes: "Reattempt requested",
          };
          break;
        case "close_case":
          updateData = {
            review_status: "completed",
            // Mark a definitive final outcome so the badge / counts render
            // correctly and the case is not treated as "still pending".
            final_outcome: "case_closed",
            completed_at: new Date().toISOString(),
            notes: "case closed",
          };
          break;
        case "mark_completed":
          updateData = {
            review_status: "completed",
            final_outcome: "case_closed",
            completed_at: new Date().toISOString(),
          };
          break;
      }

      const success = await updateDeliveryReviewStatus(selectedReview.id, updateData);

      if (success) {
        // Update the review in state with the new data
        const updatedReviews = reviews.map((r) =>
          r.id === selectedReview.id ? { ...r, ...updateData } : r
        );
        setReviews(updatedReviews);
        
        toast({
          title: "Success",
          description: `Review updated successfully`,
        });
        // Recalculate stats with updated reviews
        const fromDate = date?.from || startOfDay(new Date());
        const toDate = date?.to || endOfDay(new Date());
        calculateStats(updatedReviews, fromDate, toDate);
        setShowActionDialog(false);
      } else {
        toast({
          title: "Error",
          description: "Failed to update review",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Error updating review:", error);
      toast({
        title: "Error",
        description: "An error occurred",
        variant: "destructive",
      });
    }
  };

  const filteredReviews = reviews.filter((r) => {
    const matchesTracking = !searchTrackingNumber ||
      r.tracking_number.toLowerCase().includes(searchTrackingNumber.toLowerCase());
    const matchesOrder = !searchOrderNumber ||
      r.order_ref_number.toLowerCase().includes(searchOrderNumber.toLowerCase());
    return matchesTracking && matchesOrder;
  });

   /**
    * Check if the order is currently in "Delivery Under Review" status (0008)
    * Only orders with this status can have reattempt requests sent
    */
   const isDeliveryUnderReviewStatus = (review: DeliveryReview): boolean => {
     if (!review.raw_postex_response?.transactionStatusHistory) {
       return false;
     }

     const history = review.raw_postex_response.transactionStatusHistory;
     if (!Array.isArray(history) || history.length === 0) {
       return false;
     }

     // Get the latest status entry
     const latestEntry = history[history.length - 1];
     
     // Check if the latest status code is 0008 (Delivery Under Review)
     return latestEntry?.transactionStatusMessageCode === "0008";
   };

    const reattemptEligibleReviews = filteredReviews.filter((r) => r.review_status === "open" && isDeliveryUnderReviewStatus(r));
    const reattemptRequestedReviews = filteredReviews.filter((r) => {
      if (!r.reattempt_requested || r.review_status === "completed") {
        return false;
      }
      
      // Check if reattempt_requested_at falls within the selected date range
      if (!r.reattempt_requested_at) {
        return false;
      }
      
      const reattemptDate = new Date(r.reattempt_requested_at);
      const fromDate = date?.from || startOfDay(new Date());
      const toDate = date?.to || endOfDay(new Date());
      
      return reattemptDate >= fromDate && reattemptDate <= toDate;
    });
    const openReviews = filteredReviews.filter((r) => r.review_status === "open" && !isDeliveryUnderReviewStatus(r) && !r.reattempt_requested);
    const completedReviews = filteredReviews.filter((r) => r.review_status === "completed");

  const getReasonBadgeColor = (code: string) => {
    switch (code) {
      case "RFD":
        return "bg-red-100 text-red-800";
      case "CNA":
        return "bg-yellow-100 text-yellow-800";
      case "ICA":
        return "bg-orange-100 text-orange-800";
      case "OPN":
        return "bg-purple-100 text-purple-800";
      case "PNA":
        return "bg-pink-100 text-pink-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  const getRecommendationText = (reasonCode: string): string => {
    switch (reasonCode) {
      case "CNA":
        return "Contact the customer and request reattempt once availability is confirmed.";
      case "RFD":
        return "Contact the customer to understand the reason before requesting reattempt.";
      case "ICA":
        return "Verify the complete address with the customer before requesting reattempt.";
      case "PNA":
        return "Confirm payment availability before requesting reattempt.";
      case "OPN":
        return "Explain parcel opening policy and confirm if customer still wants delivery.";
      default:
        return "Contact the customer and review the delivery issue before taking action.";
    }
  };

  const getCustomerInitials = (name: string): string => {
    return name
      .split(" ")
      .slice(0, 2)
      .map((word) => word[0])
      .join("")
      .toUpperCase();
  };


  const getFinalStatusBadge = (review: DeliveryReview) => {
    if (review.review_status !== "completed") {
      return null;
    }

    if (review.final_outcome === "delivered_after_followup") {
      return <Badge className="bg-green-600 hover:bg-green-700">Delivered</Badge>;
    }

    if (review.final_outcome === "returned_confirmed") {
      return <Badge className="bg-blue-600 hover:bg-blue-700">Returned</Badge>;
    }

    if (review.final_outcome === "fake_attempt") {
      return <Badge className="bg-gray-600 hover:bg-gray-700">Fake Attempt</Badge>;
    }

    if (review.final_outcome === "case_closed") {
      return <Badge className="bg-purple-600 hover:bg-purple-700">Case Closed</Badge>;
    }

    return null;
  };

   const getOrderHistoryLines = (review: DeliveryReview): Array<{code: string; message: string; date: string}> => {
     if (!review.raw_postex_response?.transactionStatusHistory) {
       return [];
     }

     const history = review.raw_postex_response.transactionStatusHistory;
     return history.map((entry: any) => ({
       code: entry.transactionStatusMessageCode || 'N/A',
       message: entry.transactionStatusMessage || 'No message',
       date: format(new Date(entry.updatedAt), "MMM dd, yyyy HH:mm"),
     }));
   };

   return (
     <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-50 p-6">
       <div className="max-w-7xl mx-auto">
         <div className="mb-10">
           <div className="flex items-center gap-3 mb-2">
             <div className="h-10 w-1 bg-gradient-to-b from-blue-600 to-blue-400 rounded-full"></div>
             <h1 className="text-2xl font-bold tracking-tight text-slate-900">Delivery Under Review</h1>
           </div>
           <p className="text-slate-600 ml-4">
             Manage attempted deliveries and follow up with customers
           </p>
         </div>

         {/* Summary Cards */}
         <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4 mb-10">
           {/* Under Review Card */}
           <Card className="border border-slate-200 bg-white rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow">
             <div className="flex items-center gap-4">
               <div className="h-11 w-11 rounded-full bg-purple-100 flex items-center justify-center flex-shrink-0">
                 <AlertCircle className="h-5 w-5 text-purple-600" />
               </div>
               <div className="flex-1">
                 <p className="text-sm font-medium text-slate-700">Under Review</p>
                 <p className="mt-1 text-2xl font-bold text-slate-900">{stats.totalUnderReview}</p>
                 <p className="mt-1 text-xs text-slate-500">Open cases</p>
               </div>
             </div>
           </Card>

           {/* Reattempt Requested Card */}
           <Card className="border border-slate-200 bg-white rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow">
             <div className="flex items-center gap-4">
               <div className="h-11 w-11 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                 <RefreshCw className="h-5 w-5 text-blue-600" />
               </div>
               <div className="flex-1">
                 <p className="text-sm font-medium text-slate-700">Reattempt Requested</p>
                 <p className="mt-1 text-2xl font-bold text-slate-900">{stats.reattemptRequested}</p>
                 <p className="mt-1 text-xs text-slate-500">Requests sent</p>
               </div>
             </div>
           </Card>

           {/* Delivered After Followup Card */}
           <Card className="border border-slate-200 bg-white rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow">
             <div className="flex items-center gap-4">
               <div className="h-11 w-11 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                 <CheckCircle className="h-5 w-5 text-green-600" />
               </div>
               <div className="flex-1">
                 <p className="text-sm font-medium text-slate-700">Resolved</p>
                 <p className="mt-1 text-2xl font-bold text-slate-900">{stats.deliveredAfterFollowup}</p>
                 <p className="mt-1 text-xs text-slate-500">Successful deliveries</p>
               </div>
             </div>
           </Card>

           {/* Closed Cases Card */}
           <Card className="border border-slate-200 bg-white rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow">
             <div className="flex items-center gap-4">
               <div className="h-11 w-11 rounded-full bg-orange-100 flex items-center justify-center flex-shrink-0">
                 <XCircle className="h-5 w-5 text-orange-600" />
               </div>
               <div className="flex-1">
                 <p className="text-sm font-medium text-slate-700">Closed Cases</p>
                 <p className="mt-1 text-2xl font-bold text-slate-900">{stats.closedCases}</p>
                 <p className="mt-1 text-xs text-slate-500">Completed cases</p>
               </div>
             </div>
           </Card>
         </div>

         {/* Filters */}
         <Card className="mb-6 border-0 shadow-md bg-white">
           <CardHeader className="bg-gradient-to-r from-slate-50 to-slate-100/50 rounded-t-lg pb-4">
             <CardTitle className="text-slate-900">Filters & Search</CardTitle>
           </CardHeader>
           <CardContent className="flex gap-4 flex-wrap items-end pt-6">
            <div className="flex-1 min-w-[200px]">
              <label className="text-sm font-medium mb-2 block">Date Range</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant={"outline"}
                    className={cn(
                      "justify-start text-left font-normal w-full",
                      !date && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {date?.from ? (
                      date.to ? (
                        <>
                          {format(date.from, "LLL dd, y")} - {format(date.to, "LLL dd, y")}
                        </>
                      ) : (
                        format(date.from, "LLL dd, y")
                      )
                    ) : (
                      "Select date or range"
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarComponent
                    initialFocus
                    mode="range"
                    defaultMonth={date?.from}
                    selected={date}
                    onSelect={handleDateSelect}
                    numberOfMonths={2}
                  />
                  <div className="p-3 border-t border-border space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setQuickDate(0)}
                        className="text-xs"
                      >
                        Today
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setQuickDate(1)}
                        className="text-xs"
                      >
                        Yesterday
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setQuickDate(7)}
                        className="text-xs"
                      >
                        Last 7 Days
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setQuickDate(30)}
                        className="text-xs"
                      >
                        Last 30 Days
                      </Button>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={clearDateSelection}
                      className="w-full"
                    >
                      Reset
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>
            </div>

            <div className="flex-1 min-w-[200px]">
              <label className="text-sm font-medium mb-2 block">Search Tracking Number</label>
              <Input
                placeholder="Enter tracking number..."
                value={searchTrackingNumber}
                onChange={(e) => setSearchTrackingNumber(e.target.value)}
              />
            </div>

            <div className="flex-1 min-w-[200px]">
              <label className="text-sm font-medium mb-2 block">Search Order Number</label>
              <Input
                placeholder="Enter order number..."
                value={searchOrderNumber}
                onChange={(e) => setSearchOrderNumber(e.target.value)}
              />
            </div>

            <div className="flex items-end">
              <Button onClick={() => fetchReviews()} variant="outline">
                <RefreshCw className="h-4 w-4 mr-2" />
                Refresh
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Reattempt Eligible Section */}
        {reattemptEligibleReviews.length > 0 && (
          <div className="mb-10">
            <button
              onClick={() => setExpandedSections(prev => ({ ...prev, readyForReattempt: !prev.readyForReattempt }))}
              className="mb-5 flex items-center gap-3 w-full group hover:opacity-80 transition-opacity"
            >
              <div className="h-8 w-1 bg-gradient-to-b from-blue-600 to-blue-400 rounded-full"></div>
              <Zap className="h-6 w-6 text-blue-600" />
              <h2 className="text-lg font-bold text-slate-900 flex-1 text-left">🔥 Ready for Reattempt ({reattemptEligibleReviews.length})</h2>
              <ChevronDown 
                className={`h-6 w-6 text-slate-600 transition-transform ${
                  expandedSections.readyForReattempt ? 'transform rotate-0' : 'transform -rotate-90'
                }`}
              />
            </button>
            {expandedSections.readyForReattempt && (
            <div className="space-y-4">
              {reattemptEligibleReviews.map((review) => (
                <Card key={review.id} className="border border-slate-200 shadow-sm hover:shadow-md transition-shadow bg-white">
                  {/* Top Summary Strip */}
                  <div className="border-b border-slate-200 px-6 py-4 bg-slate-50 rounded-t-lg grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <Badge className={getReasonBadgeColor(review.review_reason_code)}>
                          {review.review_reason_code}
                        </Badge>
                        <span className="text-sm font-semibold text-slate-900">{review.review_reason_display}</span>
                      </div>
                      {review.raw_postex_response && getPreviousAttemptsHistory(review.raw_postex_response).length > 0 && (
                        <div className="flex items-center gap-1 text-xs text-slate-600 mt-2">
                          <History className="h-3 w-3" />
                          <span className="text-slate-500">
                            Previous: {formatPreviousAttempts(getPreviousAttemptsHistory(review.raw_postex_response))}
                          </span>
                        </div>
                      )}
                      <div className="flex items-center gap-1 text-xs text-slate-600">
                        <span className="h-2 w-2 rounded-full bg-orange-500"></span>
                        Under Review
                      </div>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground font-medium mb-1">Attempted on</p>
                      <p className="text-sm font-semibold">{format(new Date(review.attempt_date), "MMM dd, yyyy")}</p>
                      <p className="text-xs text-muted-foreground">{format(new Date(review.attempt_date), "HH:mm")}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground font-medium mb-1">Order Reference</p>
                      <p className="text-sm font-semibold text-slate-900">{review.order_ref_number}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground font-medium mb-1">Tracking Number</p>
                      <a
                        href={`https://postex.pk/tracking?cn=${review.tracking_number}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-sm font-semibold text-blue-600 hover:text-blue-800 flex items-center gap-1 group"
                      >
                        {review.tracking_number.slice(-8)}
                        <ExternalLink className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </a>
                    </div>
                  </div>

                  {/* Middle Content - Two Columns */}
                  <div className="border-b border-slate-200 px-6 py-5">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                      {/* Left Column: Customer Information */}
                      <div>
                        <div className="flex items-center gap-2 mb-4">
                          <User className="h-4 w-4 text-slate-600" />
                          <h3 className="text-sm font-semibold text-slate-900">Customer Information</h3>
                        </div>
                        <div className="space-y-3">
                          <div className="flex items-start gap-3">
                            <Avatar className="h-10 w-10 mt-0.5">
                              <AvatarFallback className="bg-blue-100 text-blue-700 font-semibold">
                                {getCustomerInitials(review.customer_name)}
                              </AvatarFallback>
                            </Avatar>
                            <div>
                              <p className="text-sm font-semibold text-slate-900">{review.customer_name}</p>
                              <p className="text-xs text-slate-600 flex items-center gap-1 mt-0.5">
                                <Phone className="h-3 w-3" />
                                {review.customer_phone || "N/A"}
                              </p>
                            </div>
                          </div>
                          <Separator />
                          <div>
                            <p className="text-xs text-muted-foreground font-medium mb-1">Delivery Address</p>
                            <p className="text-sm text-slate-700">{review.delivery_address || "N/A"}</p>
                          </div>
                          {review.customer_city && (
                            <>
                              <Separator />
                              <div>
                                <p className="text-xs text-muted-foreground font-medium mb-1">City</p>
                                <p className="text-sm text-slate-700">{review.customer_city}</p>
                              </div>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Right Column: Order Information */}
                      <div>
                        <div className="flex items-center gap-2 mb-4">
                          <Calendar className="h-4 w-4 text-slate-600" />
                          <h3 className="text-sm font-semibold text-slate-900">Order Information</h3>
                        </div>
                        <div className="space-y-3">
                          <div>
                            <p className="text-xs text-muted-foreground font-medium mb-1">Order Details</p>
                            <p className="text-sm text-slate-700">{review.order_detail || "N/A"}</p>
                          </div>
                          <Separator />
                          {review.order_amount !== null && (
                            <>
                              <div>
                                <p className="text-xs text-muted-foreground font-medium mb-1">Order Amount</p>
                                <p className="text-sm font-semibold text-slate-900">PKR {review.order_amount.toFixed(2)}</p>
                              </div>
                              <Separator />
                            </>
                          )}
                          <div>
                            <p className="text-xs text-muted-foreground font-medium mb-1">City</p>
                            <p className="text-sm text-slate-700">{review.customer_city || "N/A"}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Recommended Action Strip */}
                  <div className="border-b border-slate-200 px-6 py-4 bg-amber-50 flex items-start gap-3 justify-between">
                    <div className="flex items-start gap-3 flex-1">
                      <Lightbulb className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-slate-900">Recommended Action</p>
                        <p className="text-sm text-slate-700 mt-1">{getRecommendationText(review.review_reason_code)}</p>
                      </div>
                    </div>
                    {!review.reattempt_requested && (
                      <Button
                        size="sm"
                        onClick={() => handleReattemptClick(review)}
                        disabled={isReattemptLoading}
                        className="bg-blue-600 hover:bg-blue-700 text-white flex-shrink-0 ml-4"
                      >
                        <Zap className="h-4 w-4 mr-1.5" />
                        Request Reattempt
                      </Button>
                    )}
                  </div>

                  {/* Contact Status Section */}
                  <div className="border-b border-slate-200 px-6 py-4 bg-slate-50">
                    <h3 className="text-sm font-semibold text-slate-900 mb-3">Contact Status</h3>
                    <div className="flex flex-wrap gap-3">
                      <div className="flex items-center gap-2">
                        {review.customer_whatsapp_sent ? (
                          <>
                            <Badge className="bg-green-100 text-green-800 hover:bg-green-100">✓ Customer WhatsApp Sent</Badge>
                            <span className="text-xs text-slate-500">{review.customer_whatsapp_sent_at ? format(new Date(review.customer_whatsapp_sent_at), "MMM dd, yyyy HH:mm") : ""}</span>
                          </>
                        ) : (
                          <Badge className="bg-gray-200 text-gray-800 hover:bg-gray-200">○ Customer WhatsApp Pending</Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {review.sales_whatsapp_sent ? (
                          <>
                            <Badge className="bg-green-100 text-green-800 hover:bg-green-100">✓ Sales WhatsApp Sent</Badge>
                            <span className="text-xs text-slate-500">{review.sales_whatsapp_sent_at ? format(new Date(review.sales_whatsapp_sent_at), "MMM dd, yyyy HH:mm") : ""}</span>
                          </>
                        ) : (
                          <Badge className="bg-gray-200 text-gray-800 hover:bg-gray-200">○ Sales WhatsApp Pending</Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {review.postex_email_sent ? (
                          <>
                            <Badge className="bg-green-100 text-green-800 hover:bg-green-100">✓ PostEx Email Sent</Badge>
                            <span className="text-xs text-slate-500">{review.postex_email_sent_at ? format(new Date(review.postex_email_sent_at), "MMM dd, yyyy HH:mm") : ""}</span>
                          </>
                        ) : (
                          <Badge className="bg-gray-200 text-gray-800 hover:bg-gray-200">○ PostEx Email Pending</Badge>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Action Buttons Row */}
                  <div className="px-6 py-4 flex flex-wrap gap-2 justify-start border-b border-slate-200">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleWhatsAppClick(review)}
                      className={`rounded-lg border-slate-300 ${
                        review.customer_whatsapp_sent
                          ? "bg-green-50 border-green-300 hover:bg-green-100 text-green-700"
                          : "hover:bg-green-50"
                      }`}
                    >
                      <MessageCircle className="h-4 w-4 mr-1.5" />
                      {review.customer_whatsapp_sent ? "✓ WhatsApp Sent" : "WhatsApp"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const trackingLink = `https://postex.pk/tracking?cn=${review.tracking_number}`;
                        setWhatsAppSalesMessage(`${trackingLink}\n\nKindly reattempt this order as soon as possible. The customer is waiting for the order.`);
                        setWhatsAppSalesReview(review);
                        setShowWhatsAppSalesDialog(true);
                        handleWhatsAppSalesClick(review);
                      }}
                      className={`rounded-lg border-slate-300 ${
                        review.sales_whatsapp_sent
                          ? "bg-green-50 border-green-300 hover:bg-green-100 text-green-700"
                          : "hover:bg-blue-50"
                      }`}
                    >
                      <MessageCircle className="h-4 w-4 mr-1.5" />
                      {review.sales_whatsapp_sent ? "✓ Sales Notified" : "WhatsApp Sales"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const trackingLink = `https://postex.pk/tracking?cn=${review.tracking_number}`;
                        setEmailMessage(`${trackingLink}\n\nKindly reattempt this order as soon as possible. The customer is waiting for the order.`);
                        setEmailReview(review);
                        setShowEmailDialog(true);
                        handleEmailPostExClick(review);
                      }}
                      className={`rounded-lg border-slate-300 ${
                        review.postex_email_sent
                          ? "bg-green-50 border-green-300 hover:bg-green-100 text-green-700"
                          : "hover:bg-blue-50"
                      }`}
                    >
                      <Send className="h-4 w-4 mr-1.5" />
                      {review.postex_email_sent ? "✓ Email Sent" : "Email PostEx"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setHistoryReview(review);
                        setShowHistoryDialog(true);
                      }}
                      className="rounded-lg hover:bg-slate-50 border-slate-300"
                    >
                      <History className="h-4 w-4 mr-1.5" />
                      Order History
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        try {
                          await updateTrackingHistoryForReview(
                            review.id,
                            review.tracking_number,
                            review.dispatch_date
                          );
                          await fetchReviews();
                          toast({
                            title: "Success",
                            description: "Tracking history updated successfully",
                          });
                        } catch (error) {
                          console.error("Error updating tracking history:", error);
                          toast({
                            title: "Error",
                            description: "Failed to update tracking history",
                            variant: "destructive",
                          });
                        }
                      }}
                      className="rounded-lg hover:bg-slate-50 border-slate-300"
                    >
                      <RefreshCw className="h-4 w-4 mr-1.5" />
                      Refresh History
                    </Button>
                  </div>

                  {/* Footer Actions */}
                  <div className="px-6 py-4 grid grid-cols-2 gap-3">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setSelectedReview(review);
                        setActionType("mark_contacted");
                        setShowActionDialog(true);
                      }}
                      className="rounded-lg border-slate-300 hover:bg-slate-50"
                    >
                      <CheckCircle className="h-4 w-4 mr-1.5" />
                      Mark Contacted
                    </Button>
                    <AlertDialog open={showActionDialog && selectedReview?.id === review.id && actionType === "close_case"}>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setSelectedReview(review);
                          setActionType("close_case");
                          setShowActionDialog(true);
                        }}
                        className="rounded-lg border-red-300 hover:bg-red-50 text-red-600 hover:text-red-700"
                      >
                        <XCircle className="h-4 w-4 mr-1.5" />
                        Close Case
                      </Button>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Close Case</AlertDialogTitle>
                          <AlertDialogDescription>
                            Close this case and move the order to completed?
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel onClick={() => setShowActionDialog(false)}>
                            Cancel
                          </AlertDialogCancel>
                          <AlertDialogAction onClick={handleAction}>
                            Confirm
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </Card>
              ))}
            </div>
            )}
          </div>
        )}

        {/* Reattempt Requested Section */}
        {reattemptRequestedReviews.length > 0 && (
          <div className="mb-10">
            <button
              onClick={() => setExpandedSections(prev => ({ ...prev, reattemptRequested: !prev.reattemptRequested }))}
              className="mb-5 flex items-center gap-3 w-full group hover:opacity-80 transition-opacity"
            >
              <div className="h-8 w-1 bg-gradient-to-b from-blue-600 to-blue-400 rounded-full"></div>
              <Zap className="h-6 w-6 text-blue-600" />
              <h2 className="text-lg font-bold text-slate-900 flex-1 text-left">⏳ Reattempt Requested ({reattemptRequestedReviews.length})</h2>
              <ChevronDown 
                className={`h-6 w-6 text-slate-600 transition-transform ${
                  expandedSections.reattemptRequested ? 'transform rotate-0' : 'transform -rotate-90'
                }`}
              />
            </button>
            {expandedSections.reattemptRequested && (
            <div className="space-y-4">
              {reattemptRequestedReviews.map((review) => (
                <Card key={review.id} className="border border-slate-200 shadow-sm hover:shadow-md transition-shadow bg-white">
                  {/* Top Summary Strip */}
                  <div className="border-b border-slate-200 px-6 py-4 bg-slate-50 rounded-t-lg grid grid-cols-1 md:grid-cols-5 gap-4">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <Badge className={getReasonBadgeColor(review.review_reason_code)}>
                          {review.review_reason_code}
                        </Badge>
                        <span className="text-sm font-semibold text-slate-900">{review.review_reason_display}</span>
                      </div>
                      <div className="flex items-center gap-1 text-xs text-slate-600">
                        <span className="h-2 w-2 rounded-full bg-blue-500"></span>
                        Reattempt Requested
                      </div>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground font-medium mb-1">Requested on</p>
                      <p className="text-sm font-semibold">{format(new Date(review.reattempt_requested_at || review.attempt_date), "MMM dd, yyyy")}</p>
                      <p className="text-xs text-muted-foreground">{format(new Date(review.reattempt_requested_at || review.attempt_date), "HH:mm")}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground font-medium mb-1">Order Reference</p>
                      <p className="text-sm font-semibold text-slate-900">{review.order_ref_number}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground font-medium mb-1">Tracking Number</p>
                      <a
                        href={`https://postex.pk/tracking?cn=${review.tracking_number}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-sm font-semibold text-blue-600 hover:text-blue-800 flex items-center gap-1 group"
                      >
                        {review.tracking_number.slice(-8)}
                        <ExternalLink className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </a>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground font-medium mb-1">Contact Status</p>
                      <div className="flex flex-wrap gap-2">
                        {review.customer_whatsapp_sent && <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">✓ Cust</span>}
                        {review.sales_whatsapp_sent && <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">✓ Sales</span>}
                        {review.postex_email_sent && <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">✉ Email</span>}
                        {!review.customer_whatsapp_sent && !review.sales_whatsapp_sent && !review.postex_email_sent && <span className="text-xs text-gray-400">-</span>}
                      </div>
                    </div>
                  </div>

                  {/* Middle Content - Two Columns */}
                  <div className="border-b border-slate-200 px-6 py-5">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                      {/* Left Column: Customer Information */}
                      <div>
                        <div className="flex items-center gap-2 mb-4">
                          <User className="h-4 w-4 text-slate-600" />
                          <h3 className="text-sm font-semibold text-slate-900">Customer Information</h3>
                        </div>
                        <div className="space-y-3">
                          <div className="flex items-start gap-3">
                            <Avatar className="h-10 w-10 mt-0.5">
                              <AvatarFallback className="bg-blue-100 text-blue-700 font-semibold">
                                {getCustomerInitials(review.customer_name)}
                              </AvatarFallback>
                            </Avatar>
                            <div>
                              <p className="text-sm font-semibold text-slate-900">{review.customer_name}</p>
                              <p className="text-xs text-slate-600 flex items-center gap-1 mt-0.5">
                                <Phone className="h-3 w-3" />
                                {review.customer_phone || "N/A"}
                              </p>
                            </div>
                          </div>
                          <Separator />
                          <div>
                            <p className="text-xs text-muted-foreground font-medium mb-1">Delivery Address</p>
                            <p className="text-sm text-slate-700">{review.delivery_address || "N/A"}</p>
                          </div>
                          {review.customer_city && (
                            <>
                              <Separator />
                              <div>
                                <p className="text-xs text-muted-foreground font-medium mb-1">City</p>
                                <p className="text-sm text-slate-700">{review.customer_city}</p>
                              </div>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Right Column: Order Information */}
                      <div>
                        <div className="flex items-center gap-2 mb-4">
                          <Calendar className="h-4 w-4 text-slate-600" />
                          <h3 className="text-sm font-semibold text-slate-900">Order Information</h3>
                        </div>
                        <div className="space-y-3">
                          <div>
                            <p className="text-xs text-muted-foreground font-medium mb-1">Order Details</p>
                            <p className="text-sm text-slate-700">{review.order_detail || "N/A"}</p>
                          </div>
                          <Separator />
                          {review.order_amount !== null && (
                            <>
                              <div>
                                <p className="text-xs text-muted-foreground font-medium mb-1">Order Amount</p>
                                <p className="text-sm font-semibold text-slate-900">PKR {review.order_amount.toFixed(2)}</p>
                              </div>
                              <Separator />
                            </>
                          )}
                          <div>
                            <p className="text-xs text-muted-foreground font-medium mb-1">City</p>
                            <p className="text-sm text-slate-700">{review.customer_city || "N/A"}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Reattempt Status Strip */}
                  <div className="border-b border-slate-200 px-6 py-4 bg-blue-50 flex items-start gap-3 justify-between">
                    <div className="flex items-start gap-3 flex-1">
                      <CheckCircle className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-slate-900">Reattempt Status</p>
                        <p className="text-sm text-slate-700 mt-1">Request sent on {format(new Date(review.reattempt_requested_at || review.attempt_date), "MMM dd, yyyy HH:mm")}</p>
                        {review.reattempt_remarks && (
                          <p className="text-xs text-slate-600 mt-2 italic">Remarks: {review.reattempt_remarks}</p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Contact Status Section */}
                  <div className="border-b border-slate-200 px-6 py-4 bg-slate-50">
                    <h3 className="text-sm font-semibold text-slate-900 mb-3">Contact Status</h3>
                    <div className="flex flex-wrap gap-3">
                      <div className="flex items-center gap-2">
                        {review.customer_whatsapp_sent ? (
                          <>
                            <Badge className="bg-green-100 text-green-800 hover:bg-green-100">✓ Customer WhatsApp Sent</Badge>
                            <span className="text-xs text-slate-500">{review.customer_whatsapp_sent_at ? format(new Date(review.customer_whatsapp_sent_at), "MMM dd, yyyy HH:mm") : ""}</span>
                          </>
                        ) : (
                          <Badge className="bg-gray-200 text-gray-800 hover:bg-gray-200">○ Customer WhatsApp Pending</Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {review.sales_whatsapp_sent ? (
                          <>
                            <Badge className="bg-green-100 text-green-800 hover:bg-green-100">✓ Sales WhatsApp Sent</Badge>
                            <span className="text-xs text-slate-500">{review.sales_whatsapp_sent_at ? format(new Date(review.sales_whatsapp_sent_at), "MMM dd, yyyy HH:mm") : ""}</span>
                          </>
                        ) : (
                          <Badge className="bg-gray-200 text-gray-800 hover:bg-gray-200">○ Sales WhatsApp Pending</Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {review.postex_email_sent ? (
                          <>
                            <Badge className="bg-green-100 text-green-800 hover:bg-green-100">✓ PostEx Email Sent</Badge>
                            <span className="text-xs text-slate-500">{review.postex_email_sent_at ? format(new Date(review.postex_email_sent_at), "MMM dd, yyyy HH:mm") : ""}</span>
                          </>
                        ) : (
                          <Badge className="bg-gray-200 text-gray-800 hover:bg-gray-200">○ PostEx Email Pending</Badge>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Action Buttons Row */}
                  <div className="px-6 py-4 flex flex-wrap gap-2 justify-start border-b border-slate-200">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleWhatsAppClick(review)}
                      className={`rounded-lg border-slate-300 ${
                        review.customer_whatsapp_sent
                          ? "bg-green-50 border-green-300 hover:bg-green-100 text-green-700"
                          : "hover:bg-green-50"
                      }`}
                    >
                      <MessageCircle className="h-4 w-4 mr-1.5" />
                      {review.customer_whatsapp_sent ? "✓ WhatsApp Sent" : "WhatsApp"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const trackingLink = `https://postex.pk/tracking?cn=${review.tracking_number}`;
                        setWhatsAppSalesMessage(`${trackingLink}\n\nKindly reattempt this order as soon as possible. The customer is waiting for the order.`);
                        setWhatsAppSalesReview(review);
                        setShowWhatsAppSalesDialog(true);
                        handleWhatsAppSalesClick(review);
                      }}
                      className={`rounded-lg border-slate-300 ${
                        review.sales_whatsapp_sent
                          ? "bg-green-50 border-green-300 hover:bg-green-100 text-green-700"
                          : "hover:bg-blue-50"
                      }`}
                    >
                      <MessageCircle className="h-4 w-4 mr-1.5" />
                      {review.sales_whatsapp_sent ? "✓ Sales Notified" : "WhatsApp Sales"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const trackingLink = `https://postex.pk/tracking?cn=${review.tracking_number}`;
                        setEmailMessage(`${trackingLink}\n\nKindly reattempt this order as soon as possible. The customer is waiting for the order.`);
                        setEmailReview(review);
                        setShowEmailDialog(true);
                        handleEmailPostExClick(review);
                      }}
                      className={`rounded-lg border-slate-300 ${
                        review.postex_email_sent
                          ? "bg-green-50 border-green-300 hover:bg-green-100 text-green-700"
                          : "hover:bg-blue-50"
                      }`}
                    >
                      <Send className="h-4 w-4 mr-1.5" />
                      {review.postex_email_sent ? "✓ Email Sent" : "Email PostEx"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setHistoryReview(review);
                        setShowHistoryDialog(true);
                      }}
                      className="rounded-lg hover:bg-slate-50 border-slate-300"
                    >
                      <History className="h-4 w-4 mr-1.5" />
                      Order History
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        try {
                          await updateTrackingHistoryForReview(
                            review.id,
                            review.tracking_number,
                            review.dispatch_date
                          );
                          await fetchReviews();
                          toast({
                            title: "Success",
                            description: "Tracking history updated successfully",
                          });
                        } catch (error) {
                          console.error("Error updating tracking history:", error);
                          toast({
                            title: "Error",
                            description: "Failed to update tracking history",
                            variant: "destructive",
                          });
                        }
                      }}
                      className="rounded-lg hover:bg-slate-50 border-slate-300"
                    >
                      <RefreshCw className="h-4 w-4 mr-1.5" />
                      Refresh History
                    </Button>
                  </div>

                  {/* Footer Actions */}
                  <div className="px-6 py-4 grid grid-cols-2 gap-3">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setSelectedReview(review);
                        setActionType("mark_contacted");
                        setShowActionDialog(true);
                      }}
                      className="rounded-lg border-slate-300 hover:bg-slate-50"
                    >
                      <CheckCircle className="h-4 w-4 mr-1.5" />
                      Mark Contacted
                    </Button>
                    <AlertDialog open={showActionDialog && selectedReview?.id === review.id && actionType === "close_case"}>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setSelectedReview(review);
                          setActionType("close_case");
                          setShowActionDialog(true);
                        }}
                        className="rounded-lg border-red-300 hover:bg-red-50 text-red-600 hover:text-red-700"
                      >
                        <XCircle className="h-4 w-4 mr-1.5" />
                        Close Case
                      </Button>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Close Case</AlertDialogTitle>
                          <AlertDialogDescription>
                            Close this case and move the order to completed?
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel onClick={() => setShowActionDialog(false)}>
                            Cancel
                          </AlertDialogCancel>
                          <AlertDialogAction onClick={handleAction}>
                            Confirm
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </Card>
              ))}
            </div>
            )}
          </div>
        )}

        {/* Open Reviews Section */}
        <div className="mb-10">
          <button
            onClick={() => setExpandedSections(prev => ({ ...prev, openReviews: !prev.openReviews }))}
            className="mb-5 flex items-center gap-3 w-full group hover:opacity-80 transition-opacity"
          >
            <div className="h-8 w-1 bg-gradient-to-b from-orange-600 to-orange-400 rounded-full"></div>
            <AlertCircle className="h-6 w-6 text-orange-600" />
            <h2 className="text-lg font-bold text-slate-900 flex-1 text-left">Open Reviews ({openReviews.length})</h2>
            <ChevronDown 
              className={`h-6 w-6 text-slate-600 transition-transform ${
                expandedSections.openReviews ? 'transform rotate-0' : 'transform -rotate-90'
              }`}
            />
          </button>
          {expandedSections.openReviews && (
            <>
          {openReviews.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                No open reviews for the selected period
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {openReviews.map((review) => (
                <Card key={review.id} className="border border-slate-200 shadow-sm hover:shadow-md transition-shadow bg-white">
                  {/* Top Summary Strip */}
                  <div className="border-b border-slate-200 px-6 py-4 bg-slate-50 rounded-t-lg grid grid-cols-1 md:grid-cols-5 gap-4">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <Badge className={getReasonBadgeColor(review.review_reason_code)}>
                          {review.review_reason_code}
                        </Badge>
                        <span className="text-sm font-semibold text-slate-900">{review.review_reason_display}</span>
                      </div>
                      {review.raw_postex_response && getPreviousAttemptsHistory(review.raw_postex_response).length > 0 && (
                        <div className="flex items-center gap-1 text-xs text-slate-600 mt-2">
                          <History className="h-3 w-3" />
                          <span className="text-slate-500">
                            Previous: {formatPreviousAttempts(getPreviousAttemptsHistory(review.raw_postex_response))}
                          </span>
                        </div>
                      )}
                      <div className="flex items-center gap-1 text-xs text-slate-600">
                        <span className="h-2 w-2 rounded-full bg-orange-500"></span>
                        Under Review
                      </div>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground font-medium mb-1">Attempted on</p>
                      <p className="text-sm font-semibold">{format(new Date(review.attempt_date), "MMM dd, yyyy")}</p>
                      <p className="text-xs text-muted-foreground">{format(new Date(review.attempt_date), "HH:mm")}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground font-medium mb-1">Order Reference</p>
                      <p className="text-sm font-semibold text-slate-900">{review.order_ref_number}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground font-medium mb-1">Tracking Number</p>
                      <a
                        href={`https://postex.pk/tracking?cn=${review.tracking_number}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-sm font-semibold text-blue-600 hover:text-blue-800 flex items-center gap-1 group"
                      >
                        {review.tracking_number.slice(-8)}
                        <ExternalLink className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </a>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground font-medium mb-1">Contact Status</p>
                      <div className="flex flex-wrap gap-2">
                        {review.customer_whatsapp_sent && <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">✓ Cust</span>}
                        {review.sales_whatsapp_sent && <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">✓ Sales</span>}
                        {review.postex_email_sent && <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">✉ Email</span>}
                        {!review.customer_whatsapp_sent && !review.sales_whatsapp_sent && !review.postex_email_sent && <span className="text-xs text-gray-400">-</span>}
                      </div>
                    </div>
                  </div>

                  {/* Middle Content - Two Columns */}
                  <div className="border-b border-slate-200 px-6 py-5">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                      {/* Left Column: Customer Information */}
                      <div>
                        <div className="flex items-center gap-2 mb-4">
                          <User className="h-4 w-4 text-slate-600" />
                          <h3 className="text-sm font-semibold text-slate-900">Customer Information</h3>
                        </div>
                        <div className="space-y-3">
                          <div className="flex items-start gap-3">
                            <Avatar className="h-10 w-10 mt-0.5">
                              <AvatarFallback className="bg-blue-100 text-blue-700 font-semibold">
                                {getCustomerInitials(review.customer_name)}
                              </AvatarFallback>
                            </Avatar>
                            <div>
                              <p className="text-sm font-semibold text-slate-900">{review.customer_name}</p>
                              <p className="text-xs text-slate-600 flex items-center gap-1 mt-0.5">
                                <Phone className="h-3 w-3" />
                                {review.customer_phone || "N/A"}
                              </p>
                            </div>
                          </div>
                          <Separator />
                          <div>
                            <p className="text-xs text-muted-foreground font-medium mb-1">Delivery Address</p>
                            <p className="text-sm text-slate-700">{review.delivery_address || "N/A"}</p>
                          </div>
                          {review.customer_city && (
                            <>
                              <Separator />
                              <div>
                                <p className="text-xs text-muted-foreground font-medium mb-1">City</p>
                                <p className="text-sm text-slate-700">{review.customer_city}</p>
                              </div>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Right Column: Order Information */}
                      <div>
                        <div className="flex items-center gap-2 mb-4">
                          <Calendar className="h-4 w-4 text-slate-600" />
                          <h3 className="text-sm font-semibold text-slate-900">Order Information</h3>
                        </div>
                        <div className="space-y-3">
                          <div>
                            <p className="text-xs text-muted-foreground font-medium mb-1">Order Details</p>
                            <p className="text-sm text-slate-700">{review.order_detail || "N/A"}</p>
                          </div>
                          <Separator />
                          {review.order_amount !== null && (
                            <>
                              <div>
                                <p className="text-xs text-muted-foreground font-medium mb-1">Order Amount</p>
                                <p className="text-sm font-semibold text-slate-900">PKR {review.order_amount.toFixed(2)}</p>
                              </div>
                              <Separator />
                            </>
                          )}
                          <div>
                            <p className="text-xs text-muted-foreground font-medium mb-1">City</p>
                            <p className="text-sm text-slate-700">{review.customer_city || "N/A"}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Recommended Action Strip */}
                  <div className="border-b border-slate-200 px-6 py-4 bg-amber-50 flex items-start gap-3 justify-between">
                    <div className="flex items-start gap-3 flex-1">
                      <Lightbulb className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-slate-900">Recommended Action</p>
                        <p className="text-sm text-slate-700 mt-1">{getRecommendationText(review.review_reason_code)}</p>
                      </div>
                    </div>
                  </div>

                  {/* Contact Status Section */}
                  <div className="border-b border-slate-200 px-6 py-4 bg-slate-50">
                    <h3 className="text-sm font-semibold text-slate-900 mb-3">Contact Status</h3>
                    <div className="flex flex-wrap gap-3">
                      <div className="flex items-center gap-2">
                        {review.customer_whatsapp_sent ? (
                          <>
                            <Badge className="bg-green-100 text-green-800 hover:bg-green-100">✓ Customer WhatsApp Sent</Badge>
                            <span className="text-xs text-slate-500">{review.customer_whatsapp_sent_at ? format(new Date(review.customer_whatsapp_sent_at), "MMM dd, yyyy HH:mm") : ""}</span>
                          </>
                        ) : (
                          <Badge className="bg-gray-200 text-gray-800 hover:bg-gray-200">○ Customer WhatsApp Pending</Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {review.sales_whatsapp_sent ? (
                          <>
                            <Badge className="bg-green-100 text-green-800 hover:bg-green-100">✓ Sales WhatsApp Sent</Badge>
                            <span className="text-xs text-slate-500">{review.sales_whatsapp_sent_at ? format(new Date(review.sales_whatsapp_sent_at), "MMM dd, yyyy HH:mm") : ""}</span>
                          </>
                        ) : (
                          <Badge className="bg-gray-200 text-gray-800 hover:bg-gray-200">○ Sales WhatsApp Pending</Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {review.postex_email_sent ? (
                          <>
                            <Badge className="bg-green-100 text-green-800 hover:bg-green-100">✓ PostEx Email Sent</Badge>
                            <span className="text-xs text-slate-500">{review.postex_email_sent_at ? format(new Date(review.postex_email_sent_at), "MMM dd, yyyy HH:mm") : ""}</span>
                          </>
                        ) : (
                          <Badge className="bg-gray-200 text-gray-800 hover:bg-gray-200">○ PostEx Email Pending</Badge>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Action Buttons Row */}
                  <div className="px-6 py-4 flex flex-wrap gap-2 justify-start border-b border-slate-200">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleWhatsAppClick(review)}
                      className={`rounded-lg border-slate-300 ${
                        review.customer_whatsapp_sent
                          ? "bg-green-50 border-green-300 hover:bg-green-100 text-green-700"
                          : "hover:bg-green-50"
                      }`}
                    >
                      <MessageCircle className="h-4 w-4 mr-1.5" />
                      {review.customer_whatsapp_sent ? "✓ WhatsApp Sent" : "WhatsApp"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const trackingLink = `https://postex.pk/tracking?cn=${review.tracking_number}`;
                        setWhatsAppSalesMessage(`${trackingLink}\n\nKindly reattempt this order as soon as possible. The customer is waiting for the order.`);
                        setWhatsAppSalesReview(review);
                        setShowWhatsAppSalesDialog(true);
                        handleWhatsAppSalesClick(review);
                      }}
                      className={`rounded-lg border-slate-300 ${
                        review.sales_whatsapp_sent
                          ? "bg-green-50 border-green-300 hover:bg-green-100 text-green-700"
                          : "hover:bg-blue-50"
                      }`}
                    >
                      <MessageCircle className="h-4 w-4 mr-1.5" />
                      {review.sales_whatsapp_sent ? "✓ Sales Notified" : "WhatsApp Sales"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const trackingLink = `https://postex.pk/tracking?cn=${review.tracking_number}`;
                        setEmailMessage(`${trackingLink}\n\nKindly reattempt this order as soon as possible. The customer is waiting for the order.`);
                        setEmailReview(review);
                        setShowEmailDialog(true);
                        handleEmailPostExClick(review);
                      }}
                      className={`rounded-lg border-slate-300 ${
                        review.postex_email_sent
                          ? "bg-green-50 border-green-300 hover:bg-green-100 text-green-700"
                          : "hover:bg-blue-50"
                      }`}
                    >
                      <Send className="h-4 w-4 mr-1.5" />
                      {review.postex_email_sent ? "✓ Email Sent" : "Email PostEx"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setHistoryReview(review);
                        setShowHistoryDialog(true);
                      }}
                      className="rounded-lg hover:bg-slate-50 border-slate-300"
                    >
                      <History className="h-4 w-4 mr-1.5" />
                      Order History
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        try {
                          await updateTrackingHistoryForReview(
                            review.id,
                            review.tracking_number,
                            review.dispatch_date
                          );
                          await fetchReviews();
                          toast({
                            title: "Success",
                            description: "Tracking history updated successfully",
                          });
                        } catch (error) {
                          console.error("Error updating tracking history:", error);
                          toast({
                            title: "Error",
                            description: "Failed to update tracking history",
                            variant: "destructive",
                          });
                        }
                      }}
                      className="rounded-lg hover:bg-slate-50 border-slate-300"
                    >
                      <RefreshCw className="h-4 w-4 mr-1.5" />
                      Refresh History
                    </Button>
                  </div>

                  {/* Footer Actions */}
                  <div className="px-6 py-4 grid grid-cols-2 gap-3">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setSelectedReview(review);
                        setActionType("mark_contacted");
                        setShowActionDialog(true);
                      }}
                      className="rounded-lg border-slate-300 hover:bg-slate-50"
                    >
                      <CheckCircle className="h-4 w-4 mr-1.5" />
                      Mark Contacted
                    </Button>
                    <AlertDialog open={showActionDialog && selectedReview?.id === review.id && actionType === "close_case"}>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setSelectedReview(review);
                          setActionType("close_case");
                          setShowActionDialog(true);
                        }}
                        className="rounded-lg border-red-300 hover:bg-red-50 text-red-600 hover:text-red-700"
                      >
                        <XCircle className="h-4 w-4 mr-1.5" />
                        Close Case
                      </Button>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Close Case</AlertDialogTitle>
                          <AlertDialogDescription>
                            Close this case and move the order to completed?
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel onClick={() => setShowActionDialog(false)}>
                            Cancel
                          </AlertDialogCancel>
                          <AlertDialogAction onClick={handleAction}>
                            Confirm
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </Card>
              ))}
            </div>
          )}
            </>
          )}
        </div>

        {/* Completed Reviews Section */}
        <div>
          <button
            onClick={() => setExpandedSections(prev => ({ ...prev, completedReviews: !prev.completedReviews }))}
            className="mb-5 flex items-center gap-3 w-full group hover:opacity-80 transition-opacity"
          >
            <div className="h-8 w-1 bg-gradient-to-b from-green-600 to-green-400 rounded-full"></div>
            <CheckCircle className="h-6 w-6 text-green-600" />
            <h2 className="text-lg font-bold text-slate-900 flex-1 text-left">Completed Reviews ({completedReviews.length})</h2>
            <ChevronDown 
              className={`h-6 w-6 text-slate-600 transition-transform ${
                expandedSections.completedReviews ? 'transform rotate-0' : 'transform -rotate-90'
              }`}
            />
          </button>
          {expandedSections.completedReviews && (
            <>
          {completedReviews.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                No completed reviews for the selected period
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {completedReviews.map((review) => (
                <Card key={review.id} className="border border-slate-200 shadow-sm bg-white opacity-75">
                  {/* Top Summary Strip */}
                  <div className="border-b border-slate-200 px-6 py-4 bg-slate-50 rounded-t-lg grid grid-cols-1 md:grid-cols-5 gap-4">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <Badge className={getReasonBadgeColor(review.review_reason_code)}>
                          {review.review_reason_code}
                        </Badge>
                        <span className="text-sm font-semibold text-slate-900">{review.review_reason_display}</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-slate-600">
                        {getFinalStatusBadge(review)}
                      </div>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground font-medium mb-1">Completed</p>
                      <p className="text-sm font-semibold">{review.completed_at ? format(new Date(review.completed_at), "MMM dd, yyyy") : "N/A"}</p>
                      {review.completed_at && <p className="text-xs text-muted-foreground">{format(new Date(review.completed_at), "HH:mm")}</p>}
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground font-medium mb-1">Order Reference</p>
                      <p className="text-sm font-semibold text-slate-900">{review.order_ref_number}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground font-medium mb-1">Tracking Number</p>
                      <a
                        href={`https://postex.pk/tracking?cn=${review.tracking_number}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-sm font-semibold text-blue-600 hover:text-blue-800 flex items-center gap-1 group"
                      >
                        {review.tracking_number.slice(-8)}
                        <ExternalLink className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </a>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground font-medium mb-1">Contact Status</p>
                      <div className="flex flex-wrap gap-2">
                        {review.customer_whatsapp_sent && <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">✓ Cust</span>}
                        {review.sales_whatsapp_sent && <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">✓ Sales</span>}
                        {review.postex_email_sent && <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">✉ Email</span>}
                        {!review.customer_whatsapp_sent && !review.sales_whatsapp_sent && !review.postex_email_sent && <span className="text-xs text-gray-400">-</span>}
                      </div>
                    </div>
                  </div>

                  {/* Middle Content - Two Columns */}
                  <div className="border-b border-slate-200 px-6 py-5">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                      {/* Left Column: Customer Information */}
                      <div>
                        <div className="flex items-center gap-2 mb-4">
                          <User className="h-4 w-4 text-slate-600" />
                          <h3 className="text-sm font-semibold text-slate-900">Customer Information</h3>
                        </div>
                        <div className="space-y-3">
                          <div className="flex items-start gap-3">
                            <Avatar className="h-10 w-10 mt-0.5">
                              <AvatarFallback className="bg-blue-100 text-blue-700 font-semibold">
                                {getCustomerInitials(review.customer_name)}
                              </AvatarFallback>
                            </Avatar>
                            <div>
                              <p className="text-sm font-semibold text-slate-900">{review.customer_name}</p>
                              <p className="text-xs text-slate-600 flex items-center gap-1 mt-0.5">
                                <Phone className="h-3 w-3" />
                                {review.customer_phone || "N/A"}
                              </p>
                            </div>
                          </div>
                          <Separator />
                          <div>
                            <p className="text-xs text-muted-foreground font-medium mb-1">Delivery Address</p>
                            <p className="text-sm text-slate-700">{review.delivery_address || "N/A"}</p>
                          </div>
                          {review.customer_city && (
                            <>
                              <Separator />
                              <div>
                                <p className="text-xs text-muted-foreground font-medium mb-1">City</p>
                                <p className="text-sm text-slate-700">{review.customer_city}</p>
                              </div>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Right Column: Order Information */}
                      <div>
                        <div className="flex items-center gap-2 mb-4">
                          <Calendar className="h-4 w-4 text-slate-600" />
                          <h3 className="text-sm font-semibold text-slate-900">Order Information</h3>
                        </div>
                        <div className="space-y-3">
                          <div>
                            <p className="text-xs text-muted-foreground font-medium mb-1">Order Details</p>
                            <p className="text-sm text-slate-700">{review.order_detail || "N/A"}</p>
                          </div>
                          <Separator />
                          {review.order_amount !== null && (
                            <>
                              <div>
                                <p className="text-xs text-muted-foreground font-medium mb-1">Order Amount</p>
                                <p className="text-sm font-semibold text-slate-900">PKR {review.order_amount.toFixed(2)}</p>
                              </div>
                              <Separator />
                            </>
                          )}
                          <div>
                            <p className="text-xs text-muted-foreground font-medium mb-1">City</p>
                            <p className="text-sm text-slate-700">{review.customer_city || "N/A"}</p>
                          </div>
                          {review.notes && (
                            <>
                              <Separator />
                              <div>
                                <p className="text-xs text-muted-foreground font-medium mb-1">Notes</p>
                                <p className="text-sm text-slate-700">{review.notes}</p>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Footer Actions */}
                  <div className="px-6 py-4">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setHistoryReview(review);
                        setShowHistoryDialog(true);
                      }}
                      className="rounded-lg border-slate-300 hover:bg-slate-50"
                    >
                      <History className="h-4 w-4 mr-1.5" />
                      Order History
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
            </>
          )}
        </div>

        {/* Order History Dialog */}
        <AlertDialog open={showHistoryDialog}>
          <AlertDialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <AlertDialogHeader>
              <AlertDialogTitle>
                Order History - {historyReview?.tracking_number}
              </AlertDialogTitle>
              <AlertDialogDescription>
                Complete transaction history for this order
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="mt-4 space-y-3">
              {historyReview && getOrderHistoryLines(historyReview).length > 0 ? (
                getOrderHistoryLines(historyReview).map((entry, index) => (
                  <div key={index} className="border border-border rounded-lg p-3 bg-muted/50">
                    <div className="flex items-start gap-3">
                      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-semibold">
                        {index + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm">
                          [{entry.code}] {entry.message}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">{entry.date}</p>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-6 text-muted-foreground">
                  No history available for this order
                </div>
              )}
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => {
                setShowHistoryDialog(false);
                setHistoryReview(null);
              }}>
                Close
              </AlertDialogCancel>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Request Reattempt Dialog */}
        <AlertDialog open={showReattemptDialog}>
          <AlertDialogContent className="max-w-xl">
            <AlertDialogHeader>
              <AlertDialogTitle>Request Reattempt</AlertDialogTitle>
              <AlertDialogDescription>
                Send a reattempt request to the courier for this delivery
              </AlertDialogDescription>
            </AlertDialogHeader>
            {reattemptReview && (
              <div className="space-y-4 py-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Tracking Number</p>
                    <p className="font-semibold">{reattemptReview.tracking_number}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Order Reference</p>
                    <p className="font-semibold">{reattemptReview.order_ref_number}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Customer</p>
                    <p className="font-semibold">{reattemptReview.customer_name}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Attempt Reason</p>
                    <Badge className={getReasonBadgeColor(reattemptReview.review_reason_code)}>
                      {reattemptReview.review_reason_display}
                    </Badge>
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium mb-2 block">Remarks</label>
                  <Textarea
                    placeholder="Enter remarks for the courier..."
                    value={reattemptRemarks}
                    onChange={(e) => setReattemptRemarks(e.target.value)}
                    disabled={isReattemptLoading}
                    className="min-h-[100px]"
                  />
                </div>
              </div>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel 
                onClick={() => {
                  setShowReattemptDialog(false);
                  setReattemptReview(null);
                  setReattemptRemarks("Customer confirmed the order. Please arrange reattempt delivery as soon as possible.");
                }}
                disabled={isReattemptLoading}
              >
                Cancel
              </AlertDialogCancel>
              <Button 
                onClick={handleSendReattempt}
                disabled={isReattemptLoading}
                className="bg-blue-600 hover:bg-blue-700"
              >
                {isReattemptLoading ? (
                  <>
                    <Clock className="h-4 w-4 mr-2 animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4 mr-2" />
                    Send Reattempt Request
                  </>
                )}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* WhatsApp Sales Person Dialog */}
        <AlertDialog open={showWhatsAppSalesDialog}>
          <AlertDialogContent className="max-w-2xl">
            <AlertDialogHeader>
              <AlertDialogTitle>WhatsApp Sales Person</AlertDialogTitle>
              <AlertDialogDescription>
                Send a message to the sales person about this delivery
              </AlertDialogDescription>
            </AlertDialogHeader>
            {whatsAppSalesReview && (
              <div className="space-y-4 py-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Tracking Number</p>
                    <p className="font-semibold">{whatsAppSalesReview.tracking_number}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Order Reference</p>
                    <p className="font-semibold">{whatsAppSalesReview.order_ref_number}</p>
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium mb-2 block">Message</label>
                  <Textarea
                    placeholder="Edit your message..."
                    value={whatsAppSalesMessage}
                    onChange={(e) => setWhatsAppSalesMessage(e.target.value)}
                    className="min-h-[150px]"
                  />
                </div>
              </div>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel 
                onClick={() => {
                  setShowWhatsAppSalesDialog(false);
                  setWhatsAppSalesReview(null);
                  setWhatsAppSalesMessage("");
                }}
              >
                Cancel
              </AlertDialogCancel>
              <Button 
                onClick={() => {
                  if (whatsAppSalesMessage.trim()) {
                    const phone = "+923070991634";
                    const url = `https://wa.me/${phone}?text=${encodeURIComponent(whatsAppSalesMessage)}`;
                    window.open(url, "_blank");
                    toast({
                      title: "Success",
                      description: "Opening WhatsApp...",
                    });
                    setShowWhatsAppSalesDialog(false);
                    setWhatsAppSalesReview(null);
                    setWhatsAppSalesMessage("");
                  } else {
                    toast({
                      title: "Error",
                      description: "Message cannot be empty",
                      variant: "destructive",
                    });
                  }
                }}
                className="bg-green-600 hover:bg-green-700"
              >
                <MessageCircle className="h-4 w-4 mr-2" />
                Send WhatsApp
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Email PostEx Dialog */}
        <AlertDialog open={showEmailDialog}>
          <AlertDialogContent className="max-w-2xl">
            <AlertDialogHeader>
              <AlertDialogTitle>Email PostEx</AlertDialogTitle>
              <AlertDialogDescription>
                Send an email to PostEx about this delivery
              </AlertDialogDescription>
            </AlertDialogHeader>
            {emailReview && (
              <div className="space-y-4 py-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Tracking Number</p>
                    <p className="font-semibold">{emailReview.tracking_number}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Order Reference</p>
                    <p className="font-semibold">{emailReview.order_ref_number}</p>
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium mb-2 block">Message</label>
                  <Textarea
                    placeholder="Edit your message..."
                    value={emailMessage}
                    onChange={(e) => setEmailMessage(e.target.value)}
                    className="min-h-[150px]"
                  />
                </div>
              </div>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel 
                onClick={() => {
                  setShowEmailDialog(false);
                  setEmailReview(null);
                  setEmailMessage("");
                }}
              >
                Cancel
              </AlertDialogCancel>
              <Button 
                onClick={() => {
                  if (emailMessage.trim()) {
                    const email = "support@postex.pk";
                    const subject = `Delivery Issue - Tracking: ${emailReview?.tracking_number}`;
                    const body = encodeURIComponent(emailMessage);
                    const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${email}&su=${encodeURIComponent(subject)}&body=${body}`;
window.open(gmailUrl, "_blank");

toast({
  title: "Success",
  description: "Opening Gmail compose window...",
});
                    setShowEmailDialog(false);
                    setEmailReview(null);
                    setEmailMessage("");
                  } else {
                    toast({
                      title: "Error",
                      description: "Message cannot be empty",
                      variant: "destructive",
                    });
                  }
                }}
                className="bg-blue-600 hover:bg-blue-700"
              >
                <Send className="h-4 w-4 mr-2" />
                Send Email
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
