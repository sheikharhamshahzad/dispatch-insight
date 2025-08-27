import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/components/ui/use-toast";
import { Package, Edit, AlertTriangle, TrendingUp, TrendingDown, Plus, History } from "lucide-react";
import { FIFOInventoryService } from "@/services/fifoInventoryService";
import { InventoryBatch, ProductBatchSummary } from "@/types/fifo";

interface Product {
  id: string;
  name: string;
  cogs: number;
  current_stock: number;
  created_at: string;
  updated_at: string;
}

export function Inventory() {
  const [products, setProducts] = useState<Product[]>([]);
  const [productBatchSummaries, setProductBatchSummaries] = useState<ProductBatchSummary[]>([]);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [selectedProductBatches, setSelectedProductBatches] = useState<InventoryBatch[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isBatchDialogOpen, setIsBatchDialogOpen] = useState(false);
  const [formData, setFormData] = useState({
    stock: '',
    cogs: '',
  });
  const [batchFormData, setBatchFormData] = useState({
    quantity: '',
    cogs: '',
    supplierReference: '',
    notes: '',
  });
  const { toast } = useToast();

  useEffect(() => {
    fetchProducts();
    fetchProductBatchSummaries();
  }, []);

  const fetchProducts = async () => {
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .order('name');

    if (error) {
      toast({
        title: "Error",
        description: "Failed to fetch products",
        variant: "destructive",
      });
    } else {
      setProducts(data || []);
    }
  };

  const fetchProductBatchSummaries = async () => {
    const summaries = await FIFOInventoryService.getProductBatchSummaries();
    setProductBatchSummaries(summaries);
  };

  const handleAddBatch = (product: Product) => {
    setEditingProduct(product);
    setBatchFormData({
      quantity: '',
      cogs: product.cogs.toString(),
      supplierReference: '',
      notes: '',
    });
    setIsBatchDialogOpen(true);
  };

  const handleViewBatches = async (product: Product) => {
    setEditingProduct(product);
    const batches = await FIFOInventoryService.getProductBatches(product.id);
    setSelectedProductBatches(batches);
    setIsDialogOpen(true);
  };

  const handleAddBatchSubmit = async () => {
    if (!editingProduct) return;

    try {
      const quantity = parseInt(batchFormData.quantity);
      const cogs = parseFloat(batchFormData.cogs);

      if (isNaN(quantity) || quantity <= 0 || isNaN(cogs) || cogs <= 0) {
        toast({
          title: "Error",
          description: "Please enter valid quantity and COGS values",
          variant: "destructive",
        });
        return;
      }

      const batchId = await FIFOInventoryService.addInventoryBatch(
        editingProduct.id,
        quantity,
        cogs,
        batchFormData.supplierReference || undefined,
        batchFormData.notes || undefined
      );

      if (batchId) {
        toast({
          title: "Success",
          description: `Added ${quantity} units to inventory`,
        });

        setIsBatchDialogOpen(false);
        setBatchFormData({ quantity: '', cogs: '', supplierReference: '', notes: '' });
        setEditingProduct(null);
        
        // Refresh data
        await fetchProducts();
        await fetchProductBatchSummaries();
      } else {
        throw new Error('Failed to add batch');
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to add inventory batch",
        variant: "destructive",
      });
    }
  };

  const getStockStatus = (stock: number) => {
    if (stock === 0) {
      return <Badge className="bg-red-100 text-red-800 hover:bg-red-100">Out of Stock</Badge>;
    } else if (stock < 10) {
      return <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100">Low Stock</Badge>;
    } else {
      return <Badge className="bg-green-100 text-green-800 hover:bg-green-100">In Stock</Badge>;
    }
  };

  // Calculate totals using batch summaries where available
  const totalInventoryValue = products.reduce((sum, product) => {
    const batchSummary = productBatchSummaries.find(bs => bs.product_id === product.id);
    const avgCogs = batchSummary?.avg_active_cogs || product.cogs;
    return sum + (avgCogs * product.current_stock);
  }, 0);
  
  const lowStockProducts = products.filter(product => product.current_stock > 0 && product.current_stock < 10);
  const outOfStockProducts = products.filter(product => product.current_stock === 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Inventory Management</h2>
          <p className="text-muted-foreground">Manage product stock levels and cost of goods sold</p>
        </div>
      </div>

      {/* Inventory Summary */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Products</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{products.length}</div>
            <p className="text-xs text-muted-foreground">Active products</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Inventory Value</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">PKR {totalInventoryValue.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">Total COGS value</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Low Stock Alert</CardTitle>
            <AlertTriangle className="h-4 w-4 text-yellow-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600">{lowStockProducts.length}</div>
            <p className="text-xs text-muted-foreground">Products below 10 units</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Out of Stock</CardTitle>
            <TrendingDown className="h-4 w-4 text-red-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{outOfStockProducts.length}</div>
            <p className="text-xs text-muted-foreground">Products with 0 stock</p>
          </CardContent>
        </Card>
      </div>

      {/* Products Table with Batch Information */}
      <Card>
        <CardHeader>
          <CardTitle>Product Inventory with FIFO Batches</CardTitle>
          <CardDescription>
            Current stock levels, batch information, and cost tracking for all products
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product Name</TableHead>
                  <TableHead>Current Stock</TableHead>
                  <TableHead>Active Batches</TableHead>
                  <TableHead>Avg COGS</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Total Value</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.map((product) => {
                  const batchSummary = productBatchSummaries.find(bs => bs.product_id === product.id);
                  return (
                    <TableRow key={product.id}>
                      <TableCell className="font-medium">{product.name}</TableCell>
                      <TableCell className="text-lg font-semibold">
                        {product.current_stock}
                        {batchSummary && batchSummary.total_batch_remaining !== product.current_stock && (
                          <span className="text-xs text-muted-foreground ml-1">
                            ({batchSummary.total_batch_remaining} in batches)
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        {batchSummary ? batchSummary.active_batches : 0} batches
                      </TableCell>
                      <TableCell>
                        PKR {(batchSummary?.avg_active_cogs || product.cogs).toLocaleString()}
                      </TableCell>
                      <TableCell>{getStockStatus(product.current_stock)}</TableCell>
                      <TableCell className="font-medium">
                        PKR {(product.cogs * product.current_stock).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleAddBatch(product)}
                            className="flex items-center gap-1"
                          >
                            <Plus className="h-3 w-3" />
                            Add Batch
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleViewBatches(product)}
                            className="flex items-center gap-1"
                          >
                            <History className="h-3 w-3" />
                            View Batches
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* View Batches Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Inventory Batches: {editingProduct?.name}</DialogTitle>
            <DialogDescription>
              FIFO inventory batches for this product
            </DialogDescription>
          </DialogHeader>
          
          <div className="max-h-96 overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Batch Date</TableHead>
                  <TableHead>Received</TableHead>
                  <TableHead>Remaining</TableHead>
                  <TableHead>COGS per Unit</TableHead>
                  <TableHead>Total Value</TableHead>
                  <TableHead>Supplier Ref</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {selectedProductBatches.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground">
                      No batches found for this product
                    </TableCell>
                  </TableRow>
                ) : (
                  selectedProductBatches.map((batch) => (
                    <TableRow key={batch.id}>
                      <TableCell>{new Date(batch.batch_date).toLocaleDateString()}</TableCell>
                      <TableCell>{batch.quantity_received}</TableCell>
                      <TableCell className="font-medium">
                        {batch.quantity_remaining}
                        {batch.quantity_remaining === 0 && (
                          <Badge variant="secondary" className="ml-2">Depleted</Badge>
                        )}
                      </TableCell>
                      <TableCell>PKR {batch.cogs_per_unit.toLocaleString()}</TableCell>
                      <TableCell>PKR {(batch.cogs_per_unit * batch.quantity_remaining).toLocaleString()}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {batch.supplier_reference || '-'}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {batch.notes || '-'}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          
          <div className="flex justify-end">
            <Button onClick={() => setIsDialogOpen(false)}>
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add Batch Dialog */}
      <Dialog open={isBatchDialogOpen} onOpenChange={setIsBatchDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New Inventory Batch: {editingProduct?.name}</DialogTitle>
            <DialogDescription>
              Add a new FIFO batch to inventory with specific COGS
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="quantity">Quantity Received</Label>
              <Input
                id="quantity"
                type="number"
                min="1"
                value={batchFormData.quantity}
                onChange={(e) => setBatchFormData({ ...batchFormData, quantity: e.target.value })}
                placeholder="Enter quantity received"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="batch-cogs">Cost of Goods Sold per Unit (PKR)</Label>
              <Input
                id="batch-cogs"
                type="number"
                min="0"
                step="0.01"
                value={batchFormData.cogs}
                onChange={(e) => setBatchFormData({ ...batchFormData, cogs: e.target.value })}
                placeholder="Enter COGS per unit"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="supplier">Supplier Reference (Optional)</Label>
              <Input
                id="supplier"
                type="text"
                value={batchFormData.supplierReference}
                onChange={(e) => setBatchFormData({ ...batchFormData, supplierReference: e.target.value })}
                placeholder="Purchase order, invoice number, etc."
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="notes">Notes (Optional)</Label>
              <Input
                id="notes"
                type="text"
                value={batchFormData.notes}
                onChange={(e) => setBatchFormData({ ...batchFormData, notes: e.target.value })}
                placeholder="Additional notes about this batch"
              />
            </div>
            
            {batchFormData.quantity && batchFormData.cogs && (
              <div className="p-3 bg-muted rounded-lg">
                <p className="text-sm">
                  <strong>Total Batch Value:</strong> PKR {(parseFloat(batchFormData.quantity || '0') * parseFloat(batchFormData.cogs || '0')).toLocaleString()}
                </p>
              </div>
            )}
            
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIsBatchDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleAddBatchSubmit}>
                Add Batch
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}