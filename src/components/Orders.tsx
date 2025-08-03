import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/components/ui/use-toast";
import { Upload, Download, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

// Import PDF.js
import * as pdfjs from 'pdfjs-dist';

// Try this alternative way to import the worker
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.js`;

interface Order {
  id: string;
  tracking_number: string;
  order_id: string;
  customer_name: string;
  customer_address: string;
  customer_phone: string; // Add this new field
  product_name: string;
  amount: number;
  order_status: string;
  dispatch_date: string;
  return_received: boolean;
  courier_fee: number;
}

interface PostExResponse {
  statusCode: string;
  statusMessage: string;
  dist: {
    customerName: string;
    customerPhone: string;
    deliveryAddress: string;
    invoicePayment: number;
    orderDetail: string;
    orderPickupDate: string;
    orderRefNumber: string;
    orderDeliveryDate: string;
    transactionTax: number;
    transactionFee: number;
    trackingNumber: string;
    transactionDate: string;
    upfrontPayment: number;
    merchantName: string;
    transactionStatus: string;
    reversalTax: number;
    reversalFee: number;
    cityName: string;
    pickupAddress: string;
    transactionNotes: string;
    reservePaymentDate: string;
    reservePayment: number;
    balancePayment: number;
    actualWeight: number;
    transactionStatusHistory: Array<{
      transactionStatusMessage: string;
      transactionStatusMessageCode: string;
      updatedAt: string;
    }>;
    items: number;
    invoiceDivision: number;
    returnAddress: string;
  }
}

export function Orders() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7));
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [deleteTrackingNumber, setDeleteTrackingNumber] = useState<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [orderToDelete, setOrderToDelete] = useState<Order | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    fetchOrders();
  }, [selectedMonth]);

  const fetchOrders = async () => {
    const startDate = `${selectedMonth}-01`;
    const endDate = `${selectedMonth}-31`;

    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .gte('dispatch_date', startDate)
      .lte('dispatch_date', endDate)
      .order('dispatch_date', { ascending: false });

    if (error) {
      toast({
        title: "Error",
        description: "Failed to fetch orders",
        variant: "destructive",
      });
    } else {
      setOrders(data || []);
    }
  };

  // Extract tracking numbers from PDF text
  const extractTrackingNumbers = (text: string): string[] => {
    const trackingRegex = /Tracking No:\s*(\d+)/g;
    const matches = [...text.matchAll(trackingRegex)];
    return matches.map(match => match[1]);
  };

  // Fetch order details from PostEx API
  const fetchOrderDetails = async (trackingNumber: string): Promise<PostExResponse | null> => {
    try {
      console.log(`Fetching details for tracking number: ${trackingNumber}`);
      
      const response = await fetch(`https://api.postex.pk/services/integration/api/order/v1/track-order/${trackingNumber}`, {
        method: 'GET',
        headers: {
          'token': 'OTMxNzA0NTRhN2E3NGQ4MzkxMDE3YjdmYjEwNzZkM2U6NDYyNGZlMTZhNGRhNDY0NTg4YzhmZDc5OWVkYjEyMDI=',
          'Accept': 'application/json'
        }
      });
      
      // Log response status for debugging
      console.log(`Response status for ${trackingNumber}: ${response.status}`);
      
      if (!response.ok) {
        // Try to get more details about the error
        const errorText = await response.text();
        console.log(`Error details: ${errorText}`);
        throw new Error(`API Error: ${response.status}. Details: ${errorText}`);
      }
      
      return await response.json();
    } catch (error) {
      console.error(`Error fetching data for tracking number ${trackingNumber}:`, error);
      return null;
    }
  };

  // Save order to Supabase
  const saveOrderToSupabase = async (orderData: PostExResponse): Promise<boolean> => {
    try {
      const { dist } = orderData;
      
      const order = {
        tracking_number: dist.trackingNumber,
        order_id: dist.orderRefNumber,
        customer_name: dist.customerName,
        customer_address: dist.deliveryAddress,
        customer_phone: dist.customerPhone, // Add customer phone
        customer_city: dist.cityName,
        product_name: dist.orderDetail,
        amount: dist.invoicePayment,
        order_status: dist.transactionStatus.toLowerCase(),
        dispatch_date: dist.orderPickupDate,
        courier_fee: dist.transactionFee + dist.transactionTax,
        return_received: false // Default value for new orders
      };

      const { error } = await supabase.from('orders').upsert([order], {
        onConflict: 'tracking_number'
      });

      if (error) {
        console.error('Error saving order:', error);
        return false;
      }
      
      return true;
    } catch (error) {
      console.error('Error processing order data:', error);
      return false;
    }
  };

  const handlePdfUpload = async (type: 'dispatch' | 'return') => {
    if (!pdfFile) {
      toast({
        title: "Error",
        description: "Please select a PDF file first",
        variant: "destructive",
      });
      return;
    }

    setIsProcessing(true);
    
    try {
      toast({
        title: "Processing",
        description: `Extracting tracking numbers from PDF...`,
      });
      
      // Read the PDF file
      const fileData = await pdfFile.arrayBuffer();
      const pdf = await pdfjs.getDocument({ data: fileData }).promise;
      
      // Track processing statistics
      let totalTracking = 0;
      let successfulOrders = 0;
      let failedOrders = 0;
      const allTrackingNumbers: string[] = [];
      
      // Process each page of the PDF
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items
          .map(item => 'str' in item ? item.str : '')
          .join(' ');
        
        // Extract tracking numbers from this page
        const trackingNumbers = extractTrackingNumbers(pageText);
        allTrackingNumbers.push(...trackingNumbers);
      }
      
      totalTracking = allTrackingNumbers.length;
      
      toast({
        title: "Processing",
        description: `Found ${totalTracking} tracking numbers. Fetching order details...`,
      });
      
      // Process tracking numbers based on type
      if (type === 'dispatch') {
        // For dispatch: Fetch order details and save to database
        for (const trackingNumber of allTrackingNumbers) {
          const orderData = await fetchOrderDetails(trackingNumber);
          
          if (orderData && orderData.statusCode === "200") {
            const success = await saveOrderToSupabase(orderData);
            if (success) {
              successfulOrders++;
            } else {
              failedOrders++;
            }
          } else {
            failedOrders++;
          }
        }
      } else if (type === 'return') {
        // For returns: Update return_received status
        for (const trackingNumber of allTrackingNumbers) {
          const { error } = await supabase
            .from('orders')
            .update({ return_received: true })
            .eq('tracking_number', trackingNumber);
          
          if (!error) {
            successfulOrders++;
          } else {
            failedOrders++;
          }
        }
      }
      
      // Reset file input
      setPdfFile(null);
      const fileInputs = document.querySelectorAll('input[type="file"]') as NodeListOf<HTMLInputElement>;
      fileInputs.forEach(input => input.value = '');
      
      // Show results and refresh orders
      toast({
        title: "Complete",
        description: `Processed ${totalTracking} orders: ${successfulOrders} successful, ${failedOrders} failed.`,
        variant: successfulOrders > 0 ? "default" : "destructive",
      });
      
      // Refresh orders list
      fetchOrders();
      
    } catch (error) {
      console.error('PDF processing error:', error);
      toast({
        title: "Error",
        description: "Failed to process PDF: " + (error instanceof Error ? error.message : "Unknown error"),
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // Add this function before the return statement
  const handleDeleteOrder = async () => {
    if (!orderToDelete) return;
    
    try {
      const { error } = await supabase
        .from('orders')
        .delete()
        .eq('id', orderToDelete.id);
      
      if (error) {
        toast({
          title: "Error",
          description: "Failed to delete order: " + error.message,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Success",
          description: "Order deleted successfully",
        });
        // Refresh orders list
        fetchOrders();
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "An unexpected error occurred",
        variant: "destructive",
      });
    } finally {
      // Close dialog and reset state
      setDeleteConfirmOpen(false);
      setOrderToDelete(null);
    }
  };

  const openDeleteConfirm = (order: Order) => {
    setOrderToDelete(order);
    setDeleteConfirmOpen(true);
  };

  const getStatusBadge = (status: string) => {
    const statusColors = {
      dispatched: "bg-blue-100 text-blue-800 hover:bg-blue-100",
      delivered: "bg-green-100 text-green-800 hover:bg-green-100",
      returned: "bg-yellow-100 text-yellow-800 hover:bg-yellow-100",
      failed: "bg-red-100 text-red-800 hover:bg-red-100",
    };
    
    return (
      <Badge className={statusColors[status as keyof typeof statusColors] || "bg-gray-100 text-gray-800"}>
        {status}
      </Badge>
    );
  };

  // Add this function before the return statement
  const toggleReturnStatus = async (order: Order) => {
    try {
      const newStatus = !order.return_received;
      
      const { error } = await supabase
        .from('orders')
        .update({ return_received: newStatus })
        .eq('id', order.id);
      
      if (error) {
        toast({
          title: "Error",
          description: "Failed to update return status: " + error.message,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Success",
          description: `Return status updated to ${newStatus ? 'Received' : 'Not Received'}`,
        });
        // Refresh orders list
        fetchOrders();
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "An unexpected error occurred",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Orders Management</h2>
          <p className="text-muted-foreground">Track and manage parcel operations</p>
        </div>
        <Select value={selectedMonth} onValueChange={setSelectedMonth}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Select month" />
          </SelectTrigger>
          <SelectContent>
            {Array.from({ length: 12 }, (_, i) => {
              const date = new Date();
              date.setMonth(date.getMonth() - i);
              const value = date.toISOString().slice(0, 7);
              const label = date.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
              return (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>

      {/* PDF Upload Section */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5" />
              Upload Dispatch PDF
            </CardTitle>
            <CardDescription>
              Upload PDF with courier labels to automatically process orders
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input
              type="file"
              accept=".pdf"
              onChange={(e) => setPdfFile(e.target.files?.[0] || null)}
            />
            <Button 
              onClick={() => handlePdfUpload('dispatch')} 
              disabled={!pdfFile || isProcessing}
              className="w-full"
            >
              {isProcessing ? "Processing..." : "Process Dispatch PDF"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Download className="h-5 w-5" />
              Upload Return PDF
            </CardTitle>
            <CardDescription>
              Upload PDF with return labels to mark returns as received
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input
              type="file"
              accept=".pdf"
              onChange={(e) => setPdfFile(e.target.files?.[0] || null)}
            />
            <Button 
              onClick={() => handlePdfUpload('return')} 
              disabled={!pdfFile || isProcessing}
              className="w-full"
              variant="outline"
            >
              {isProcessing ? "Processing..." : "Process Return PDF"}
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Orders Table */}
      <Card>
        <CardHeader>
          <CardTitle>Orders for {new Date(selectedMonth).toLocaleDateString('en-US', { year: 'numeric', month: 'long' })}</CardTitle>
          <CardDescription>
            {orders.length} orders found
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order ID</TableHead>
                  <TableHead>Tracking Number</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Customer Phone</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Dispatch Date</TableHead>
                  <TableHead>Return Received</TableHead>
                  <TableHead>Courier Fee</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((order) => (
                  <TableRow key={order.id}>
                    <TableCell className="font-medium">{order.order_id}</TableCell>
                    <TableCell>
                      <a 
                        href={`https://postex.pk/tracking?cn=${order.tracking_number}`}
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline"
                      >
                        {order.tracking_number}
                      </a>
                    </TableCell>
                    <TableCell>
                      <div>
                        <div className="font-medium">{order.customer_name}</div>
                        <div className="text-sm text-muted-foreground truncate max-w-xs">
                          {order.customer_address}<br></br>{order.customer_city}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>{order.customer_phone}</TableCell>
                    <TableCell>{order.product_name}</TableCell>
                    <TableCell>PKR {order.amount}</TableCell>
                    <TableCell>{getStatusBadge(order.order_status)}</TableCell>
                    <TableCell>{new Date(order.dispatch_date).toLocaleDateString()}</TableCell>
                    <TableCell>
                      <Badge 
                        className={order.return_received 
                          ? "bg-green-100 text-green-800 hover:bg-green-200 cursor-pointer" 
                          : "bg-gray-100 text-gray-800 hover:bg-gray-200 cursor-pointer"}
                        onClick={() => toggleReturnStatus(order)}
                      >
                        {order.return_received ? "Yes" : "No"}
                      </Badge>
                    </TableCell>
                    <TableCell>PKR {order.courier_fee}</TableCell>
                    <TableCell>
                      <Button 
                        variant="destructive" 
                        size="icon" 
                        onClick={() => openDeleteConfirm(order)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          
          {orders.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              No orders found for this month
            </div>
          )}
        </CardContent>
      </Card>

      {/* Delete Confirmation Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Deletion</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this order? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => setIsDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button 
              onClick={() => deleteTrackingNumber && handleDeleteOrder(deleteTrackingNumber)} 
              className="bg-red-600 hover:bg-red-700"
            >
              Delete Order
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog for new handler */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Deletion</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this order? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex space-x-2 justify-end">
            <Button variant="outline" onClick={() => setDeleteConfirmOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteOrder}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}